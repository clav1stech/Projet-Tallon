#!/usr/bin/env python3
"""Profilage léger des fichiers de data/raw/ (stdlib uniquement).

Imprime en markdown le schéma de chaque fichier (en-têtes, volumétrie,
échantillon) SANS charger les CSV en mémoire — sert à mettre à jour le
catalogue data/raw/README.md à coût token nul.

Usage : python3 python/profile_raw.py
"""

import csv
import json
import os
import sqlite3
import sys

RAW_DIR = "data/raw"


def profile_csv(path):
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        reader = csv.reader(fh)
        header = next(reader, [])
        sample = next(reader, [])
        count = sum(1 for _ in fh)  # streaming, approx (lignes restantes)
    print(f"- Lignes de données : ~{count + 1}")
    print(f"- Colonnes ({len(header)}) : {', '.join(header)}")
    print(f"- Échantillon : {sample}")


def profile_geojson(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    feats = data.get("features", [])
    print(f"- Type : {data.get('type')} — {len(feats)} features")
    if feats:
        f = feats[0]
        print(f"- Géométrie : {f['geometry']['type']}")
        props = f.get("properties", {})
        print(f"- Propriétés : {', '.join(props.keys())}")
        print(f"- Échantillon : {json.dumps(props, ensure_ascii=False)[:300]}")


def profile_gpkg(path):
    con = sqlite3.connect(path)
    try:
        rows = con.execute(
            "SELECT table_name, data_type, srs_id FROM gpkg_contents"
        ).fetchall()
        for table, dtype, srs in rows:
            print(f"- Couche `{table}` ({dtype}, EPSG:{srs})")
            if dtype == "features":
                cols = con.execute(f'PRAGMA table_info("{table}")').fetchall()
                print(f"  - Colonnes : {', '.join(c[1] for c in cols)}")
                n = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                print(f"  - Lignes : {n}")
    finally:
        con.close()


def main():
    if not os.path.isdir(RAW_DIR):
        sys.exit(f"❌ Répertoire introuvable : {RAW_DIR}")
    for root, _dirs, files in os.walk(RAW_DIR):
        for name in sorted(files):
            if name == "README.md" or name.startswith("."):
                continue
            path = os.path.join(root, name)
            size_mb = os.path.getsize(path) / 1024 / 1024
            rel = os.path.relpath(path, RAW_DIR)
            print(f"\n## {rel} ({size_mb:.1f} Mo)")
            ext = os.path.splitext(name)[1].lower()
            try:
                if ext == ".csv":
                    profile_csv(path)
                elif ext == ".geojson":
                    profile_geojson(path)
                elif ext == ".gpkg":
                    profile_gpkg(path)
                else:
                    print("- (format non profilé)")
            except Exception as e:  # fichier corrompu/inattendu : signaler, continuer
                print(f"- ⚠️ Erreur de profilage : {e}")


if __name__ == "__main__":
    main()
