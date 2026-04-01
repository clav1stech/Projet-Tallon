#!/usr/bin/env python3
"""
migrate_v2_to_v3.py
Migration du schéma JSON masterRoutes v2 → v3 :
  - masterRoutes → trajets
  - baseDurationToNext → durationToNext (par point de route)
  - segmentLength supprimé des points de route
  - voie: 1|2 ajouté au niveau trajet (south-north=1, north-south=2)

Usage :
  python3 migrate_v2_to_v3.py [--dry-run]
"""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
INPUT_PATH = ROOT / "data" / "masterRoutes.normalized.json"
BACKUP_PATH = ROOT / "data" / "masterRoutes.normalized.v2.bak.json"

VOIE_MAP = {
    "south-north": 1,
    "north-south": 2,
}


def migrate(data: dict) -> dict:
    schema = data.get("_schema", "")
    if schema == "v3":
        print("Fichier déjà en v3, rien à faire.")
        sys.exit(0)
    if schema != "v2":
        print(f"AVERTISSEMENT : _schema inattendu '{schema}', migration quand même.")

    points = data.get("points", {})
    master_routes = data.get("masterRoutes", [])

    trajets = []
    stripped_count = 0
    missing_duration_count = 0

    for route in master_routes:
        direction = route.get("direction", "")
        voie = VOIE_MAP.get(direction, 1)

        new_points = []
        for pt in route.get("points", []):
            new_pt = {"id": pt["id"]}

            raw_dur = pt.get("baseDurationToNext")
            if raw_dur is None:
                missing_duration_count += 1
                raw_dur = 0
            new_pt["durationToNext"] = raw_dur

            if "segmentLength" in pt:
                stripped_count += 1

            new_points.append(new_pt)

        trajet = {
            "id": route["id"],
            "name": route.get("name", route["id"]),
            "voie": voie,
        }
        if direction:
            trajet["direction"] = direction
        trajet["points"] = new_points
        trajets.append(trajet)

    result = {
        "_schema": "v3",
        "points": points,
        "trajets": trajets,
    }

    print(f"  Trajets migrés   : {len(trajets)}")
    print(f"  segmentLength supprimés : {stripped_count}")
    if missing_duration_count:
        print(f"  AVERTISSEMENT : {missing_duration_count} points sans baseDurationToNext (→ 0)")

    return result


def main():
    dry_run = "--dry-run" in sys.argv

    if not INPUT_PATH.exists():
        print(f"ERREUR : fichier introuvable : {INPUT_PATH}")
        sys.exit(1)

    with open(INPUT_PATH, encoding="utf-8") as f:
        data = json.load(f)

    print(f"Migration {INPUT_PATH.name} v2 → v3")
    result = migrate(data)

    if dry_run:
        print("Mode dry-run : aucune écriture.")
        preview = json.dumps(result, ensure_ascii=False, indent=2)
        # Afficher les 60 premières lignes pour contrôle
        lines = preview.splitlines()
        for line in lines[:60]:
            print(line)
        if len(lines) > 60:
            print(f"  ... ({len(lines) - 60} lignes supplémentaires)")
        return

    # Backup
    shutil.copy2(INPUT_PATH, BACKUP_PATH)
    print(f"  Backup créé      : {BACKUP_PATH.name}")

    with open(INPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"  Fichier écrit    : {INPUT_PATH.name}")
    print("Migration terminée.")


if __name__ == "__main__":
    main()
