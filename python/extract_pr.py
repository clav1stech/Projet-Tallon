#!/usr/bin/env python3
"""Extraction des PR routiers (IGN BD TOPO) pour le mode voiture (stdlib, non interactif).

Produit data/csv/road_pr.csv (versionné, ~460 lignes) à partir des deux gros
CSV de data/raw/road/ (non versionnés) : corridors A406, A40 et D1212.

Piège des données source : sur autoroute, `abscisse` redémarre à chaque
`identifiant_de_section` et les numéros de PR ne sont pas monotones de Mâcon
à Sallanches (sections APRR puis ATMB). L'ordre géométrique est donc
reconstruit par chaînage plus-proche-voisin depuis un point de départ connu,
et une colonne `pk_cum` (km cumulés depuis le début du corridor) est émise :
c'est elle qui sert d'axe au corridor dans l'app. Le PR réel (`numero`) et
TOUTES les colonnes d'origine sont conservés pour de futures features.

Usage (depuis la racine du dépôt) :
    python3 python/extract_pr.py
"""

import csv
import math
import os
import sys

OUTPUT = "data/csv/road_pr.csv"

# Un corridor = une route filtrée dans un des deux fichiers source, chaînée
# depuis start (lat, lon). Ajouter une entrée ici pour un nouveau corridor.
CORRIDORS = [
    {
        "id": "a406",
        "file": "data/raw/road/pr-national-autoroutes.csv",
        "route": "A406",
        "dept": None,
        "start": (46.277, 4.804),   # jonction A6, sud de Mâcon
    },
    {
        "id": "a40",
        "file": "data/raw/road/pr-national-autoroutes.csv",
        "route": "A40",
        "dept": None,
        "start": (46.338, 4.853),   # jonction A406, nord de Mâcon
    },
    {
        "id": "d1212",
        "file": "data/raw/road/pr-departemental.csv",
        "route": "D1212",
        "dept": "74",
        "start": (45.936, 6.630),   # Sallanches
    },
]

# Préférence de côté quand un PR existe en double (chaussées G/D)
COTE_PRIORITY = {"D": 0, "U": 1, "G": 2}


def dist_km(a_lat, a_lon, b_lat, b_lon):
    # Équirectangulaire, suffisant pour ordonner des points à ~1 km d'écart
    kx = 111.32 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lat - b_lat) * 111.32, (a_lon - b_lon) * kx)


def load_corridor(cfg):
    rows = []
    with open(cfg["file"], newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames
        for row in reader:
            if row["route"] != cfg["route"]:
                continue
            if cfg["dept"] and row["code_insee_du_departement"].strip('"') != cfg["dept"]:
                continue
            # PR valides uniquement (écarte les repères DS/FS "Calculé" de fin de section)
            if not row["statut"].startswith("PR"):
                continue
            try:
                row["_lat"] = float(row["Y"])
                row["_lon"] = float(row["X"])
            except ValueError:
                continue
            rows.append(row)

    # Déduplication des chaussées : les PR existent en double G/D (~15 m
    # d'écart) mais avec des identifiants de section DISJOINTS entre G et D.
    # La clé fiable est (numero, gestionnaire) : la numérotation PR est unique
    # par concessionnaire (A40 : APRR PR 102..207, ATMB PR 0..102).
    # Côté préféré : D > U > G.
    best = {}
    for row in rows:
        key = (row["numero"], row["gestionnaire"])
        prio = COTE_PRIORITY.get(row["cote"], 9)
        if key not in best or prio < COTE_PRIORITY.get(best[key]["cote"], 9):
            best[key] = row
    points = list(best.values())

    # Chaînage plus-proche-voisin depuis le point de départ du trajet.
    # Coupé au premier saut aberrant : les points situés DERRIÈRE le départ
    # (ex: tronçon A40↔A6 jamais parcouru) sont rattachés en fin de chaîne
    # par le glouton avec un saut de plusieurs dizaines de km — on les écarte.
    MAX_STEP_KM = 10.0
    ordered = []
    dropped = 0
    current = min(points, key=lambda r: dist_km(cfg["start"][0], cfg["start"][1], r["_lat"], r["_lon"]))
    remaining = [r for r in points if r is not current]
    ordered.append(current)
    while remaining:
        nxt = min(remaining, key=lambda r: dist_km(current["_lat"], current["_lon"], r["_lat"], r["_lon"]))
        if dist_km(current["_lat"], current["_lon"], nxt["_lat"], nxt["_lon"]) > MAX_STEP_KM:
            dropped = len(remaining)
            break
        remaining.remove(nxt)
        ordered.append(nxt)
        current = nxt
    if dropped:
        print(f"  ℹ️ {cfg['id']} : {dropped} point(s) écarté(s) au-delà d'un saut > {MAX_STEP_KM} km "
              f"(hors du parcours chaîné)")

    # pk_cum : km cumulés le long de la chaîne
    pk = 0.0
    prev = None
    for row in ordered:
        if prev is not None:
            pk += dist_km(prev["_lat"], prev["_lon"], row["_lat"], row["_lon"])
        row["pk_cum"] = f"{pk:.3f}"
        row["corridor"] = cfg["id"]
        prev = row
    return header, ordered


def main():
    all_rows = []
    source_header = None
    print("Corridors extraits :")
    for cfg in CORRIDORS:
        if not os.path.exists(cfg["file"]):
            sys.exit(f"❌ Fichier source introuvable : {cfg['file']}")
        header, ordered = load_corridor(cfg)
        source_header = source_header or header
        if len(ordered) < 2:
            sys.exit(f"❌ Corridor {cfg['id']} : moins de 2 points ({len(ordered)})")
        total = float(ordered[-1]["pk_cum"])
        step_max = max(
            dist_km(a["_lat"], a["_lon"], b["_lat"], b["_lon"])
            for a, b in zip(ordered, ordered[1:])
        )
        print(f"  ✅ {cfg['id']} ({cfg['route']}) : {len(ordered)} points, "
              f"{total:.1f} km, pas max {step_max:.2f} km")
        all_rows.extend(ordered)

    fieldnames = ["corridor", "pk_cum"] + source_header
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)

    size_kb = os.path.getsize(OUTPUT) / 1024
    print(f"✅ {OUTPUT} : {len(all_rows)} lignes, {len(fieldnames)} colonnes, {size_kb:.0f} Ko")


if __name__ == "__main__":
    main()
