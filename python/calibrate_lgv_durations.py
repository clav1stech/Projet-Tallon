"""Recalage des durées Paris ⇄ Mâcon-Loché sur les horaires commerciaux.

Usage :
    python3 python/calibrate_lgv_durations.py            # simulation (aucune écriture)
    python3 python/calibrate_lgv_durations.py --apply    # sauvegarde datée puis écriture

Méthode :
- le corridor Paris-Gare-de-Lyon → Créteil (830000) → Moisenay (752100) →
  Mâcon-Loché (LGV 752000) est repéré en PK : chaque point est placé au PK où
  se projettent ses coordonnées de voie, comme le suit le moteur ; les longueurs
  sont des différences de PK, non des distances à vol d'oiseau ;
- une marche tendue y est simulée sur le profil de ligne extrait de
  data/csv/rail_pk.csv (line_profile.py) : vitesses limites nominales et
  déclivités, moyennées sur la longueur du train ; rame type TGV Duplex
  (puissance, effort au démarrage, résistance à l'avancement de type Davis),
  freinage de service ; une hausse de limite ne s'applique qu'une fois la queue
  du train dégagée ; sorties et entrées de gare aux vitesses de STATION_ZONES ;
- la différence entre l'horaire commercial et la marche tendue est la marge ;
  une réserve de régularité (ECO_DRIVING, uniforme en pourcentage du temps)
  couvre les aléas, et le reste est consommé par la conduite économe : vitesse
  de croisière plafonnée, cherchée pour tenir l'horaire, et marche sur l'erre
  avant les descentes et les baisses de limite (vitesse en tête de pente telle
  que la rame atteigne la limite au creux sans traction ni freinage). La marge
  se place donc là où la conduite la dépense, surtout sur les sections les plus
  rapides, et non au prorata des distances ;
- seule l'étendue CALIBRATED_SPANS est recalée. L'approche de Paris au retour
  (Moisenay → Paris) en est exclue : elle porte la marge d'arrivée au terminus,
  supérieure à celle de la ligne, et le reste de la marge ne s'y répartit pas.

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
from collections import deque
from datetime import date

from fix_route_durations import BACKUP_DIR, DATA_FILE, ROOT, write_atomic
from line_profile import load_line_profile

# Corridor dans le sens Paris → Mâcon : (ligne, point de début, point de fin).
CORRIDOR = [
    ('830000', 'PARIS_LYON', 'BIF_DE_CRETEIL'),
    ('752100', 'BIF_DE_CRETEIL', 'BIF_DE_MOISENAY'),
    ('752000', 'BIF_DE_MOISENAY', 'MACON_LOCHE'),
]

# Horaires commerciaux sans arrêt intermédiaire (gare à gare, en secondes).
REFERENCE_TOTALS_S = {
    'PAR_MAC_SUD': 94 * 60,   # 18 h 46 → 20 h 20
    'MAC_PAR_NORD': 96 * 60,  # 7 h 38 → 9 h 14
}

# Étendue recalée (premier et dernier point, dans l'ordre du trajet).
CALIBRATED_SPANS = {
    'PAR_MAC_SUD': ('PARIS_LYON', 'MACON_LOCHE'),
    'MAC_PAR_NORD': ('MACON_LOCHE', 'BIF_DE_MOISENAY'),
}

# Durées actuelles sur l'étendue recalée, dans l'ordre du trajet.
EXPECTED_DURATIONS_S = {
    'PAR_MAC_SUD': [370, 109, 87, 304, 89, 191, 347, 88, 306, 280, 307, 19, 301,
                    298, 311, 229, 91, 253, 292, 81, 298, 285, 307, 116, 281],
    'MAC_PAR_NORD': [298, 124, 310, 286, 299, 87, 293, 253, 96, 228, 341, 275,
                     282, 38, 315, 277, 307, 86, 349],
}

# Le 160 km/h que rail_pk.csv porte sur la 752000 jusqu'au PK 18,5 vise la
# branche d'Interconnexion, non le tronc venant de Paris : celui-ci garde la
# limite de la 752100 (270 km/h) à la jonction de Moisenay.
JUNCTION_LIMIT = {'line': '752000', 'below_pk': 18.5, 'speed_kmh': 270}
# Vitesse de passage à Moisenay quand l'étendue recalée s'y arrête.
JUNCTION_SPEED_KMH = 270

# Gorge de gare et aiguillages d'accès : paliers (distance au point d'arrêt en
# km, vitesse plafond en km/h), du plus proche au plus lointain. rail_pk.csv
# porte la vitesse des voies principales (100 km/h dès le PK 0 à Paris), non
# celle des voies à quai et du faisceau d'avant-gare.
STATION_ZONES = {
    'PARIS_LYON': [(0.8, 30), (2.2, 60)],
    'MACON_LOCHE': [(1.6, 160)],
}

TRAIN = {
    'mass_kg': 450_000,          # rame chargée
    'rotating_factor': 1.06,     # masses tournantes
    'length_m': 400,             # unité multiple
    'power_w': 8_800_000,        # puissance à la jante
    'max_effort_n': 220_000,     # effort au démarrage
    'davis_kn': (2.7, 0.032, 0.00055),  # A + B·V + C·V², V en km/h
    'service_braking_ms2': 0.45,
}
GRAVITY_MS2 = 9.81
# Conduite économe : la marge au-delà de la réserve de régularité (uniforme, en
# pourcentage du temps, pour les aléas) est consommée par un plafond de vitesse
# de croisière et la marche sur l'erre ; le plafond est cherché dans l'intervalle.
ECO_DRIVING = {'regularity_reserve': 0.05, 'cruise_search_kmh': (120, 320)}
# Écart toléré entre un point et la ligne du corridor sur laquelle il se projette.
MAX_PROJECTION_KM = 0.3
STEP_M = 5.0


def point_coordinates(point, voie):
    """Coordonnées propres à la voie si renseignées (règle de buildEffectiveRoute)."""
    lat, lon = point.get(f'lat_V{voie}'), point.get(f'lon_V{voie}')
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return lat, lon
    return point['lat'], point['lon']


class Corridor:
    """Abscisse continue (km depuis Paris) sur une suite de lignes repérées en PK."""

    def __init__(self, data, voie):
        points = data['points']
        self.profiles = {line: load_line_profile(line) for line, _, _ in CORRIDOR}
        self.pieces = []      # (ligne, abscisse de début, PK de début, sens, longueur)
        self.positions = {}
        offset = 0.0
        for line, start_id, end_id in CORRIDOR:
            profile = self.profiles[line]
            pk_start = profile.project_pk(*point_coordinates(points[start_id], voie))
            pk_end = profile.project_pk(*point_coordinates(points[end_id], voie))
            direction = 1 if pk_end >= pk_start else -1
            self.pieces.append((line, offset, pk_start, direction, abs(pk_end - pk_start)))
            self.positions.setdefault(start_id, offset)
            offset += abs(pk_end - pk_start)
            self.positions[end_id] = offset
        self.length = offset

    def locate(self, x):
        for line, offset, pk_start, direction, length in self.pieces:
            if x <= offset + length:
                return line, pk_start + direction * (x - offset), direction
        line, offset, pk_start, direction, length = self.pieces[-1]
        return line, pk_start + direction * length, direction

    def position(self, point_id, point, voie):
        if point_id in self.positions:
            return self.positions[point_id]
        best = None
        for line, offset, pk_start, direction, length in self.pieces:
            pk, distance = self.profiles[line].project(*point_coordinates(point, voie))
            along = min(max((pk - pk_start) * direction, 0.0), length)
            if best is None or distance < best[0]:
                best = (distance, offset + along)
        if best[0] > MAX_PROJECTION_KM:
            raise ValueError(f'{point_id} à {best[0]:.2f} km du corridor')
        return best[1]

    def speed_limit_ms(self, x, stations=True):
        for point_id, zone in STATION_ZONES.items():
            if not stations:
                break
            if point_id not in self.positions:
                continue
            gap = abs(self.positions[point_id] - x)
            for length_km, speed_kmh in zone:
                if gap <= length_km:
                    return speed_kmh / 3.6
        line, pk, _ = self.locate(x)
        if line == JUNCTION_LIMIT['line'] and pk < JUNCTION_LIMIT['below_pk']:
            return JUNCTION_LIMIT['speed_kmh'] / 3.6
        return self.profiles[line].speed_limit_kmh(pk) / 3.6

    def gradient_permil(self, x):
        """Déclivité au point x dans le sens Paris → Mâcon (positive en montée)."""
        line, pk, direction = self.locate(x)
        return self.profiles[line].gradient_permil(pk - direction * STEP_M / 1000, pk)


def davis_resistance_n(speed_ms):
    a, b, c = TRAIN['davis_kn']
    v = speed_ms * 3.6
    return (a + b * v + c * v * v) * 1000


def sliding_min(values, window):
    """Minimum de values[i - window .. i] pour chaque i (file monotone)."""
    result, queue = [], deque()
    for i, value in enumerate(values):
        while queue and values[queue[-1]] >= value:
            queue.pop()
        queue.append(i)
        if queue[0] < i - window:
            queue.popleft()
        result.append(values[queue[0]])
    return result


class RunModel:
    """Marche d'une rame sur une étendue, distances cumulées dans le sens de marche.

    limit_at(km) (limites de ligne et zones de gare) et line_limit_at(km)
    (limites de ligne seules) en m/s, gradient_at(km) en ‰ (positif en montée),
    sont donnés pour la tête du train, en km parcourus depuis l'origine. Le
    train entier respecte chaque limite (minimum sur sa longueur) et subit la
    déclivité moyenne sur sa longueur.
    """

    def __init__(self, distances_km, limit_at, line_limit_at, gradient_at, start_ms, end_ms):
        self.steps = int(round(sum(distances_km) * 1000 / STEP_M))
        xs = [i * STEP_M / 1000 for i in range(self.steps + 1)]
        window = int(round(TRAIN['length_m'] / STEP_M))
        self.limit = sliding_min([limit_at(x) for x in xs], window)
        self.line_limit = sliding_min([line_limit_at(x) for x in xs], window)
        head = [gradient_at(x) for x in xs]
        prefix = [0.0]
        for value in head:
            prefix.append(prefix[-1] + value)
        self.slope_n = [TRAIN['mass_kg'] * GRAVITY_MS2 / 1000
                        * (prefix[i + 1] - prefix[max(0, i - window)]) / (i + 1 - max(0, i - window))
                        for i in range(self.steps + 1)]
        self.start_ms, self.end_ms = start_ms, end_ms
        self.bounds, cumulated = [0], 0.0
        for km in distances_km:
            cumulated += km
            self.bounds.append(min(self.steps, int(round(cumulated * 1000 / STEP_M))))

    def segment_times(self, cruise_ms=float('inf'), eco=False):
        """Temps par segment.

        Sans eco : marche tendue (traction maximale jusqu'à la limite, freinage
        de service). Avec eco : conduite économe, vitesse plafonnée à cruise_ms
        et marche sur l'erre avant chaque descente ou baisse de limite, la
        vitesse en tête de pente étant celle qui, sans traction ni freinage,
        atteint la limite au creux. Les arrêts restent abordés au freinage.
        """
        steps, mass = self.steps, TRAIN['mass_kg'] * TRAIN['rotating_factor']
        ceiling = [min(v, cruise_ms) for v in self.limit]
        if eco:
            coast = [min(v, cruise_ms) for v in self.line_limit]
            for i in range(steps - 1, -1, -1):
                v = coast[i + 1]
                accel = (-davis_resistance_n(v) - self.slope_n[i]) / mass
                coast[i] = min(coast[i], max(v * v - 2 * accel * STEP_M, 1.0) ** 0.5)
            ceiling = [min(a, b) for a, b in zip(ceiling, coast)]
        speed = [0.0] * (steps + 1)
        speed[0] = min(self.start_ms, ceiling[0])
        for i in range(steps):
            v = max(speed[i], 0.5)
            effort = min(TRAIN['max_effort_n'], TRAIN['power_w'] / v)
            accel = (effort - davis_resistance_n(v) - self.slope_n[i]) / mass
            speed[i + 1] = min(max(v * v + 2 * accel * STEP_M, 1.0) ** 0.5, ceiling[i + 1])
        speed[steps] = min(speed[steps], self.end_ms)
        braking = TRAIN['service_braking_ms2']
        for i in range(steps - 1, -1, -1):
            speed[i] = min(speed[i], (speed[i + 1] ** 2 + 2 * braking * STEP_M) ** 0.5)
        elapsed = [0.0]
        for i in range(steps):
            elapsed.append(elapsed[-1] + 2 * STEP_M / (speed[i] + speed[i + 1]))
        return [elapsed[b] - elapsed[a] for a, b in zip(self.bounds, self.bounds[1:])]


def round_preserving_total(values, total):
    floors = [int(v) for v in values]
    remainder = total - sum(floors)
    order = sorted(range(len(values)), key=lambda i: values[i] - floors[i], reverse=True)
    for i in order[:remainder]:
        floors[i] += 1
    return floors


def boundary_speed_ms(point_id):
    return 0.0 if point_id in STATION_ZONES else JUNCTION_SPEED_KMH / 3.6


def calibrate(data, route_id):
    route = next(route for route in data['trajets'] if route['id'] == route_id)
    voie = route['voie']
    seq = route['points']
    ids = [point['id'] for point in seq]
    first_id, last_id = CALIBRATED_SPANS[route_id]
    first, last = ids.index(first_id), ids.index(last_id)
    span = seq[first:last + 1]
    corridor = Corridor(data, voie)
    xs = [corridor.position(p['id'], data['points'][p['id']], voie) for p in span]
    distances = [abs(b - a) for a, b in zip(xs, xs[1:])]
    direction = 1 if xs[-1] > xs[0] else -1
    origin = xs[0]

    def limit_at(km_travelled):
        return corridor.speed_limit_ms(origin + direction * km_travelled)

    def line_limit_at(km_travelled):
        return corridor.speed_limit_ms(origin + direction * km_travelled, stations=False)

    def gradient_at(km_travelled):
        return direction * corridor.gradient_permil(origin + direction * km_travelled)

    model = RunModel(distances, limit_at, line_limit_at, gradient_at,
                     boundary_speed_ms(first_id), boundary_speed_ms(last_id))
    tight = model.segment_times()
    fixed = sum(p['durationToNext'] or 0 for i, p in enumerate(seq[:-1]) if not first <= i < last)
    target = REFERENCE_TOTALS_S[route_id] - fixed
    reserve = 1 + ECO_DRIVING['regularity_reserve']
    if sum(tight) * reserve >= target:
        raise ValueError(f'{route_id} : marche tendue + réserve ({sum(tight) * reserve:.0f} s) '
                         f'au-delà de l\'horaire ({target} s)')
    low, high = (speed / 3.6 for speed in ECO_DRIVING['cruise_search_kmh'])
    while high - low > 0.01:
        middle = (low + high) / 2
        if sum(model.segment_times(middle, eco=True)) * reserve > target:
            low = middle
        else:
            high = middle
    eco = model.segment_times(high, eco=True)
    # Le résidu de la recherche (< 1 s) suit la même répartition que la réserve.
    scale = target / sum(eco)
    durations = round_preserving_total([t * scale for t in eco], target)
    segments = [(a['id'], b['id'], km, t) for a, b, km, t in zip(span, span[1:], distances, tight)]
    return route, first, durations, segments, sum(tight), high * 3.6


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--apply', action='store_true', help='sauvegarder puis écrire le fichier')
    args = parser.parse_args()

    data = json.loads(DATA_FILE.read_text(encoding='utf-8'))
    changed, errors = 0, []
    for route_id, expected in EXPECTED_DURATIONS_S.items():
        route, first, durations, segments, tight_total, cruise_kmh = calibrate(data, route_id)
        current = [p['durationToNext'] for p in route['points'][first:first + len(durations)]]
        if current == durations:
            print(f'{route_id} : déjà recalé.')
            continue
        if current != expected:
            errors.append(f'{route_id} : durées {current}, {expected} attendues')
            continue
        print(f'{route_id} : marge totale {sum(durations) / tight_total - 1:.1%} sur la marche tendue, '
              f'conduite économe à {cruise_kmh:.0f} km/h au plus, '
              f'réserve {ECO_DRIVING["regularity_reserve"]:.0%}')
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
