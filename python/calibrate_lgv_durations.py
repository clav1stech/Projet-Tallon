"""Recalage des durées LGV Paris ⇄ Mâcon-Loché sur les horaires commerciaux.

Usage :
    python3 python/calibrate_lgv_durations.py            # simulation (aucune écriture)
    python3 python/calibrate_lgv_durations.py --apply    # sauvegarde datée puis écriture

Méthode :
- la portion Paris-Gare-de-Lyon ⇄ bifurcation de Moisenay n'est jamais modifiée ;
- sur la LGV (ligne 752000, longueurs tirées des PK où se projettent les
  coordonnées des points, non des distances à vol d'oiseau), une marche tendue est simulée sur le profil de ligne extrait de
  data/csv/rail_pk.csv (line_profile.py) : vitesses limites nominales et
  déclivités, moyennées sur la longueur du train ; rame type TGV Duplex
  (puissance, effort au démarrage, résistance à l'avancement de type Davis),
  freinage de service, aiguillages de Mâcon-Loché à 160 km/h ; une hausse de
  limite ne s'applique qu'une fois la queue du train dégagée ;
- la différence entre l'horaire commercial et la marche tendue est la marge de
  régularité ; elle est répartie au prorata du temps de marche tendue de chaque
  segment (marge en pourcentage du temps, et non de la distance), de sorte que
  démarrage, freinage et rampes reçoivent une part conforme à leur durée.

Chaque trajet porte les durées actuelles attendues : si les données ont changé
depuis l'analyse, le script refuse d'écrire. Des durées déjà recalées sont
ignorées (relance sans effet).

Stdlib uniquement.
"""

import argparse
import json
import os
import shutil
import sys
from datetime import date

from fix_route_durations import BACKUP_DIR, DATA_FILE, ROOT, write_atomic
from line_profile import load_line_profile

LGV_LINE = '752000'
JUNCTION = 'BIF_DE_MOISENAY'
STATION = 'MACON_LOCHE'

# Horaires commerciaux sans arrêt intermédiaire (gare à gare, en secondes).
REFERENCE_TOTALS_S = {
    'PAR_MAC_SUD': 94 * 60,   # 18 h 46 → 20 h 20
    'MAC_PAR_NORD': 96 * 60,  # 7 h 38 → 9 h 14
}

# Durées actuelles de Moisenay à Mâcon-Loché, dans l'ordre du trajet.
EXPECTED_LGV_DURATIONS_S = {
    'PAR_MAC_SUD': [359, 90, 315, 290, 314, 20, 310, 286, 341, 235, 93, 261,
                    297, 86, 308, 294, 314, 119, 289],
    'MAC_PAR_NORD': [304, 117, 309, 287, 305, 84, 290, 256, 93, 229, 320, 295,
                     293, 29, 311, 278, 308, 88, 348],
}

# Vitesse au passage de Moisenay : limite de la ligne 752100 côté Paris. Le
# 160 km/h que rail_pk.csv porte sur la 752000 jusqu'au PK 18,5 vise la
# branche d'Interconnexion, non le tronc venant de Paris.
JUNCTION_SPEED_KMH = 270
JUNCTION_ZONE_END_PK = 18.5

TRAIN = {
    'mass_kg': 450_000,          # rame chargée
    'rotating_factor': 1.06,     # masses tournantes
    'length_m': 400,             # unité multiple
    'power_w': 8_800_000,        # puissance à la jante
    'max_effort_n': 220_000,     # effort au démarrage
    'davis_kn': (2.7, 0.032, 0.00055),  # A + B·V + C·V², V en km/h
    'service_braking_ms2': 0.45,
}
STATION_TURNOUT = {'speed_kmh': 160, 'length_km': 1.6}
GRAVITY_MS2 = 9.81
STEP_M = 5.0


def lgv_pk_km(profile, point, voie):
    """PK de la position du point sur la LGV, projetée depuis ses coordonnées de voie.

    Le moteur suit les coordonnées (règle de buildEffectiveRoute) : les champs PK
    des bifurcations, parfois intervertis entre voies, ne font pas foi.
    """
    lat, lon = point.get(f'lat_V{voie}'), point.get(f'lon_V{voie}')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        lat, lon = point['lat'], point['lon']
    return profile.project_pk(lat, lon)


def lgv_slice(route):
    ids = [point['id'] for point in route['points']]
    a, b = ids.index(JUNCTION), ids.index(STATION)
    return (a, b) if a < b else (b, a)


def davis_resistance_n(speed_ms):
    a, b, c = TRAIN['davis_kn']
    v = speed_ms * 3.6
    return (a + b * v + c * v * v) * 1000


def tight_run_times(distances_km, limit_at, gradient_at, start_ms, end_ms):
    """Temps de marche tendue par segment, distances cumulées dans le sens de marche.

    limit_at(km) en m/s et gradient_at(km) en ‰ (positif en montée) sont donnés
    pour la tête du train, en km parcourus depuis l'origine.
    """
    total_m = sum(distances_km) * 1000
    steps = int(round(total_m / STEP_M))
    xs = [i * STEP_M / 1000 for i in range(steps + 1)]
    window = int(round(TRAIN['length_m'] / STEP_M))
    head_limit = [limit_at(x) for x in xs]
    # Le train entier doit respecter chaque limite : minimum sur sa longueur.
    limit = [min(head_limit[max(0, i - window):i + 1]) for i in range(steps + 1)]
    head_gradient = [gradient_at(x) for x in xs]
    gradient = [sum(head_gradient[max(0, i - window):i + 1]) / (i + 1 - max(0, i - window))
                for i in range(steps + 1)]
    mass = TRAIN['mass_kg'] * TRAIN['rotating_factor']
    speed = [0.0] * (steps + 1)
    speed[0] = min(start_ms, limit[0])
    for i in range(steps):
        v = max(speed[i], 0.5)
        effort = min(TRAIN['max_effort_n'], TRAIN['power_w'] / v)
        slope = TRAIN['mass_kg'] * GRAVITY_MS2 * gradient[i] / 1000
        accel = (effort - davis_resistance_n(v) - slope) / mass
        speed[i + 1] = min(max(v * v + 2 * accel * STEP_M, 1.0) ** 0.5, limit[i + 1])
    speed[steps] = min(speed[steps], end_ms)
    braking = TRAIN['service_braking_ms2']
    for i in range(steps - 1, -1, -1):
        speed[i] = min(speed[i], (speed[i + 1] ** 2 + 2 * braking * STEP_M) ** 0.5)
    elapsed = [0.0]
    for i in range(steps):
        elapsed.append(elapsed[-1] + 2 * STEP_M / (speed[i] + speed[i + 1]))
    bounds, cumulated = [0], 0.0
    for km in distances_km:
        cumulated += km
        bounds.append(min(steps, int(round(cumulated * 1000 / STEP_M))))
    return [elapsed[b] - elapsed[a] for a, b in zip(bounds, bounds[1:])]


def round_preserving_total(values, total):
    floors = [int(v) for v in values]
    remainder = total - sum(floors)
    order = sorted(range(len(values)), key=lambda i: values[i] - floors[i], reverse=True)
    for i in order[:remainder]:
        floors[i] += 1
    return floors


def calibrate(data, route_id):
    route = next(route for route in data['trajets'] if route['id'] == route_id)
    voie = route['voie']
    points = data['points']
    first, last = lgv_slice(route)
    seq = route['points']
    lgv = seq[first:last + 1]
    profile = load_line_profile(LGV_LINE)
    pks = [lgv_pk_km(profile, points[p['id']], voie) for p in lgv]
    distances = [abs(b - a) for a, b in zip(pks, pks[1:])]
    station_pk = pks[-1] if lgv[-1]['id'] == STATION else pks[0]
    towards_station = pks[-1] > pks[0]
    origin = pks[0]
    direction = 1 if towards_station else -1

    def pk_at(km_travelled):
        return origin + direction * km_travelled

    def limit_at(km_travelled):
        pk = pk_at(km_travelled)
        if abs(station_pk - pk) <= STATION_TURNOUT['length_km']:
            return STATION_TURNOUT['speed_kmh'] / 3.6
        if pk < JUNCTION_ZONE_END_PK:
            return JUNCTION_SPEED_KMH / 3.6
        return profile.speed_limit_kmh(pk) / 3.6

    def gradient_at(km_travelled):
        pk = pk_at(km_travelled)
        return profile.gradient_permil(pk - direction * STEP_M / 1000, pk)

    junction_ms = JUNCTION_SPEED_KMH / 3.6
    start, end = (junction_ms, 0.0) if towards_station else (0.0, junction_ms)
    tight = tight_run_times(distances, limit_at, gradient_at, start, end)

    fixed = sum(p['durationToNext'] or 0 for i, p in enumerate(seq[:-1]) if not first <= i < last)
    target = REFERENCE_TOTALS_S[route_id] - fixed
    scale = target / sum(tight)
    durations = round_preserving_total([t * scale for t in tight], target)
    segments = [(a['id'], b['id'], km, t) for a, b, km, t in zip(lgv, lgv[1:], distances, tight)]
    return route, first, durations, segments, scale - 1


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--apply', action='store_true', help='sauvegarder puis écrire le fichier')
    args = parser.parse_args()

    data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
    changed, errors = 0, []
    for route_id, expected in EXPECTED_LGV_DURATIONS_S.items():
        route, first, durations, segments, margin = calibrate(data, route_id)
        current = [p['durationToNext'] for p in route['points'][first:first + len(durations)]]
        if current == durations:
            print(f'{route_id} : déjà recalé.')
            continue
        if current != expected:
            errors.append(f'{route_id} : durées {current}, {expected} attendues')
            continue
        print(f'{route_id} : marge de régularité {margin:.1%} sur la marche tendue')
        for (a, b, km, tight), old, new in zip(segments, current, durations):
            print(f'  {a[:26]:26} → {b[:26]:26} {km:6.2f} km  tendue {tight:4.0f} s  '
                  f'{old:4d} → {new:4d} s ({new - old:+4d})  {km / new * 3600:4.0f} km/h')
        for offset, value in enumerate(durations):
            route['points'][first + offset]['durationToNext'] = value
        total = sum(p['durationToNext'] or 0 for p in route['points'][:-1])
        print(f'  total {total // 60} min {total % 60:02d} s')
        changed += 1
    if errors:
        print('Refus, données différentes de celles analysées :', *errors, sep='\n  ')
        return 1
    if not changed:
        return 0
    if not args.apply:
        print('Simulation : relancer avec --apply pour écrire.')
        return 0

    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f'masterRoutes.normalized.{date.today().isoformat()}.json'
    if backup.exists():
        backup = backup.with_name(f'{backup.stem}.{os.getpid()}.json')
    shutil.copy2(DATA_FILE, backup)
    print(f'Sauvegarde : {backup.relative_to(ROOT)}')
    write_atomic(DATA_FILE, json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f'Écrit : {DATA_FILE.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
