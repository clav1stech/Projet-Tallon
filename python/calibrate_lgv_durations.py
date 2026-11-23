"""Recalage des durées LGV Paris ⇄ Mâcon-Loché sur les horaires commerciaux.

Usage :
    python3 python/calibrate_lgv_durations.py            # simulation (aucune écriture)
    python3 python/calibrate_lgv_durations.py --apply    # sauvegarde datée puis écriture

Méthode :
- la portion Paris-Gare-de-Lyon ⇄ bifurcation de Moisenay n'est jamais modifiée ;
- sur la LGV (ligne 752000, longueurs tirées des PK, non des distances à vol
  d'oiseau), une marche tendue est simulée : rame type TGV Duplex (puissance,
  effort au démarrage, résistance à l'avancement de type Davis), freinage de
  service, 270 km/h de Moisenay à Saint-Florentin (bifurcation de Vergigny),
  300 km/h au-delà, aiguillages de Mâcon-Loché à 160 km/h ;
- la différence entre l'horaire commercial et la marche tendue est la marge de
  régularité ; elle est répartie au prorata du temps de marche tendue de chaque
  segment (marge en pourcentage du temps, et non de la distance), de sorte que
  démarrage et freinage reçoivent une part conforme à leur durée physique ;
- les déclivités, absentes des données, ne sont pas modélisées : leur effet
  est absorbé par la marge.

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
    'PAR_MAC_SUD': [350, 87, 300, 283, 305, 21, 310, 286, 320, 230, 85, 236,
                    280, 87, 290, 276, 289, 115, 340],
    'MAC_PAR_NORD': [290, 115, 279, 284, 270, 85, 270, 225, 95, 255, 330, 294,
                     281, 35, 290, 290, 299, 83, 343],
}

# Vitesse au passage de Moisenay, cohérente avec la portion francilienne figée.
JUNCTION_SPEED_KMH = {'PAR_MAC_SUD': 250, 'MAC_PAR_NORD': 220}

TRAIN = {
    'mass_kg': 450_000,          # rame chargée
    'rotating_factor': 1.06,     # masses tournantes
    'power_w': 8_800_000,        # puissance à la jante
    'max_effort_n': 220_000,     # effort au démarrage
    'davis_kn': (2.7, 0.032, 0.00055),  # A + B·V + C·V², V en km/h
    'service_braking_ms2': 0.45,
}
LINE_SPEED_KMH = {'before_saint_florentin': 270, 'after_saint_florentin': 300}
STATION_TURNOUT = {'speed_kmh': 160, 'length_km': 1.6}
STEP_M = 5.0


def parse_pk_km(value):
    if value in (None, ''):
        return None
    return float(str(value).replace(',', '.'))


def lgv_pk_km(point, voie):
    """PK du point sur la LGV pour la voie donnée (bifurcations : repère propre à la voie)."""
    if point.get('type') == 'bifurcation':
        if point.get('code_ligne') == LGV_LINE:
            return parse_pk_km(point.get(f'PK_V{voie}'))
        if point.get('code_ligne_2') == LGV_LINE:
            return parse_pk_km(point.get(f'PK_2_V{voie}'))
        return None
    return parse_pk_km(point.get('PK')) if point.get('code_ligne') == LGV_LINE else None


def lgv_slice(route):
    ids = [point['id'] for point in route['points']]
    a, b = ids.index(JUNCTION), ids.index(STATION)
    return (a, b) if a < b else (b, a)


def davis_resistance_n(speed_ms):
    a, b, c = TRAIN['davis_kn']
    v = speed_ms * 3.6
    return (a + b * v + c * v * v) * 1000


def tight_run_times(distances_km, limit_at, start_ms, end_ms):
    """Temps de marche tendue par segment, distances cumulées dans le sens de marche."""
    total_m = sum(distances_km) * 1000
    steps = int(round(total_m / STEP_M))
    xs = [i * STEP_M for i in range(steps + 1)]
    mass = TRAIN['mass_kg'] * TRAIN['rotating_factor']
    speed = [0.0] * (steps + 1)
    speed[0] = min(start_ms, limit_at(0))
    for i in range(steps):
        v = max(speed[i], 0.5)
        effort = min(TRAIN['max_effort_n'], TRAIN['power_w'] / v)
        accel = (effort - davis_resistance_n(v)) / mass
        speed[i + 1] = min(max(v * v + 2 * accel * STEP_M, 0) ** 0.5, limit_at(xs[i + 1] / 1000))
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
    pks = [lgv_pk_km(points[p['id']], voie) for p in lgv]
    if any(pk is None for pk in pks):
        raise ValueError(f'{route_id} : PK LGV manquant')
    distances = [abs(b - a) for a, b in zip(pks, pks[1:])]
    saint_florentin = lgv_pk_km(points['BIF_DE_VERGIGNY'], voie)
    station_pk = lgv_pk_km(points[STATION], voie)
    towards_station = pks[-1] > pks[0]
    origin = pks[0]

    def limit_at(km_travelled):
        pk = origin + km_travelled if towards_station else origin - km_travelled
        if abs(station_pk - pk) <= STATION_TURNOUT['length_km']:
            return STATION_TURNOUT['speed_kmh'] / 3.6
        key = 'before_saint_florentin' if pk < saint_florentin else 'after_saint_florentin'
        return LINE_SPEED_KMH[key] / 3.6

    junction_ms = JUNCTION_SPEED_KMH[route_id] / 3.6
    start, end = (junction_ms, 0.0) if towards_station else (0.0, junction_ms)
    tight = tight_run_times(distances, limit_at, start, end)

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
