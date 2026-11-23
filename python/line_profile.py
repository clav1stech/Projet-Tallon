"""Profil d'une ligne ferroviaire tiré de data/csv/rail_pk.csv : vitesse limite et déclivité par PK.

Usage :
    python3 python/line_profile.py                    # LGV 752000, PK 17 → 334
    python3 python/line_profile.py --line 752000 --from 17 --to 334 --step 10

- `vitesse` est la vitesse maximale nominale de la ligne au PK (SNCF Réseau) ;
  une valeur NULL reprend la limite précédente.
- La déclivité se calcule sur `altitude_declivites` (profil en long de la voie,
  pentes bornées à ±35 ‰ sur la LGV) et jamais sur `altitude` ou
  `altitude_tunnels`, altitudes du terrain qui donnent des pentes de ±100 ‰.
  Cette altitude cumule une dérive de plusieurs dizaines de mètres par rapport
  au terrain : seule sa variation locale est exploitable.

Stdlib uniquement.
"""

import argparse
import bisect
import csv
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAIL_PK_FILE = ROOT / 'data' / 'csv' / 'rail_pk.csv'


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class LineProfile:
    """Vitesse limite (km/h) et déclivité (‰, positive en montée vers les PK croissants)."""

    def __init__(self, pks, speeds, altitudes, coordinates):
        self.pks = pks
        self.speeds = speeds
        self.altitudes = altitudes
        self.coordinates = coordinates

    def project_pk(self, lat, lon):
        """PK du point de la ligne le plus proche de (lat, lon), interpolé entre deux repères."""
        scale = math.cos(math.radians(lat))

        def plane(i):
            plat, plon = self.coordinates[i]
            return (plon - lon) * scale, plat - lat

        nearest = min(range(len(self.pks)), key=lambda i: sum(c * c for c in plane(i)))
        best_pk, best_distance = self.pks[nearest], float('inf')
        for a, b in ((nearest - 1, nearest), (nearest, nearest + 1)):
            if a < 0 or b >= len(self.pks):
                continue
            (ax, ay), (bx, by) = plane(a), plane(b)
            dx, dy = bx - ax, by - ay
            span = dx * dx + dy * dy
            ratio = min(max(-(ax * dx + ay * dy) / span, 0.0), 1.0) if span else 0.0
            distance = (ax + ratio * dx) ** 2 + (ay + ratio * dy) ** 2
            if distance < best_distance:
                best_pk, best_distance = self.pks[a] + ratio * (self.pks[b] - self.pks[a]), distance
        return best_pk

    def _index(self, pk):
        return min(max(bisect.bisect_right(self.pks, pk) - 1, 0), len(self.pks) - 1)

    def speed_limit_kmh(self, pk):
        return self.speeds[self._index(pk)]

    def altitude_m(self, pk):
        i = self._index(pk)
        if i >= len(self.pks) - 1:
            return self.altitudes[-1]
        span = self.pks[i + 1] - self.pks[i]
        ratio = (pk - self.pks[i]) / span if span else 0.0
        return self.altitudes[i] + ratio * (self.altitudes[i + 1] - self.altitudes[i])

    def gradient_permil(self, pk_start, pk_end):
        """Déclivité moyenne entre deux PK, dans le sens pk_start → pk_end."""
        length_m = abs(pk_end - pk_start) * 1000
        if not length_m:
            return 0.0
        return (self.altitude_m(pk_end) - self.altitude_m(pk_start)) / length_m * 1000


def load_line_profile(code_ligne, path=RAIL_PK_FILE):
    rows = []
    with open(path, newline='', encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            if row['code_ligne'] != code_ligne:
                continue
            pk = _number(row['pk'])
            if pk is not None:
                rows.append((pk, _number(row['vitesse']), _number(row['altitude_declivites']),
                             (_number(row['lat']), _number(row['lon']))))
    if not rows:
        raise ValueError(f'ligne {code_ligne} absente de {path}')
    rows.sort()
    pks, speeds, altitudes, coordinates = [], [], [], []
    last_speed = next((speed for _, speed, _, _ in rows if speed is not None), None)
    for pk, speed, altitude, position in rows:
        coordinates.append(position)
        last_speed = speed if speed is not None else last_speed
        pks.append(pk)
        speeds.append(last_speed)
        altitudes.append(altitude)
    # Altitudes manquantes : interpolation linéaire entre les voisins connus.
    known = [i for i, altitude in enumerate(altitudes) if altitude is not None]
    if not known:
        raise ValueError(f'ligne {code_ligne} sans altitude de déclivité')
    for i, altitude in enumerate(altitudes):
        if altitude is not None:
            continue
        before = max((k for k in known if k < i), default=None)
        after = min((k for k in known if k > i), default=None)
        if before is None or after is None:
            altitudes[i] = altitudes[after if before is None else before]
        else:
            ratio = (pks[i] - pks[before]) / (pks[after] - pks[before])
            altitudes[i] = altitudes[before] + ratio * (altitudes[after] - altitudes[before])
    return LineProfile(pks, speeds, altitudes, coordinates)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--line', default='752000')
    parser.add_argument('--from', dest='start', type=float, default=17.0)
    parser.add_argument('--to', dest='end', type=float, default=334.0)
    parser.add_argument('--step', type=float, default=10.0, help='pas de synthèse en km')
    args = parser.parse_args()

    profile = load_line_profile(args.line)
    print(f'Ligne {args.line} : PK {profile.pks[0]:g} → {profile.pks[-1]:g}')
    print('Vitesses limites :')
    previous = None
    for pk, speed in zip(profile.pks, profile.speeds):
        if args.start <= pk <= args.end and speed != previous:
            print(f'  PK {pk:7.1f} : {speed:.0f} km/h' if speed else f'  PK {pk:7.1f} : inconnue')
        previous = speed
    print(f'Déclivité moyenne par tronçon de {args.step:g} km :')
    pk = args.start
    while pk < args.end:
        upper = min(pk + args.step, args.end)
        print(f'  PK {pk:6.1f} → {upper:6.1f} : {profile.gradient_permil(pk, upper):+6.1f} ‰  '
              f'(altitude relative {profile.altitude_m(upper) - profile.altitude_m(args.start):+6.0f} m)')
        pk = upper


if __name__ == '__main__':
    main()
