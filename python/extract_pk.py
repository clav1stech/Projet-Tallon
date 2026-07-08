#!/usr/bin/env python3
"""Extraction des PK ferroviaires pour l'app (stdlib uniquement, non interactif).

Filtre le gros CSV SNCF (data/raw/rail/pks 2.csv, ~30 Mo, non versionné) sur
les lignes utilisées par l'app et produit un CSV léger versionné, TOUTES
colonnes conservées (évite une ré-extraction quand de futures features
voudront vitesse/altitude). Relancer avec --lines pour ajouter des lignes.

Usage (défauts adaptés au dépôt, lancer depuis la racine) :
    python3 python/extract_pk.py
    python3 python/extract_pk.py --lines 752000 752100 830000 886000
"""

import argparse
import csv
import os
import sys

DEFAULT_INPUT = "data/raw/rail/pks 2.csv"
DEFAULT_OUTPUT = "data/csv/rail_pk.csv"
# code_ligne utilisés par les points de data/masterRoutes.normalized.json
DEFAULT_LINES = ["752000", "752100", "830000"]


def is_number(value):
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--lines", nargs="+", default=DEFAULT_LINES,
                        help="codes ligne SNCF à conserver")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        sys.exit(f"❌ Fichier source introuvable : {args.input}")

    wanted = set(str(code) for code in args.lines)
    kept = {code: 0 for code in wanted}
    dropped_invalid = 0
    rows = []

    with open(args.input, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames
        for required in ("code_ligne", "pk", "lat", "lon"):
            if required not in header:
                sys.exit(f"❌ Colonne attendue absente du fichier source : {required}")
        for row in reader:
            code = row["code_ligne"]
            if code not in wanted:
                continue
            # pk/lat/lon doivent être numériques (le fichier contient des NULL littéraux)
            if not all(is_number(row[c]) for c in ("pk", "lat", "lon")):
                dropped_invalid += 1
                continue
            kept[code] += 1
            rows.append(row)

    rows.sort(key=lambda r: (r["code_ligne"], float(r["pk"])))

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)

    print(f"✅ {args.output} : {len(rows)} points, {len(header)} colonnes")
    for code in sorted(wanted):
        status = "✅" if kept[code] else "⚠️  AUCUN POINT"
        print(f"  {status} ligne {code} : {kept[code]} points")
    if dropped_invalid:
        print(f"  (ℹ️ {dropped_invalid} lignes écartées : pk/lat/lon non numérique)")
    size_kb = os.path.getsize(args.output) / 1024
    print(f"  taille : {size_kb:.0f} Ko")

    if len(rows) < 2:
        sys.exit("❌ Moins de 2 points extraits — vérifier --lines")


if __name__ == "__main__":
    main()
