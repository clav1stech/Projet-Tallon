#!/usr/bin/env python3
"""Raffinage des corridors routiers depuis une trace GPS réelle (stdlib, non interactif).

Produit data/csv/road_trace.csv (versionné) : la géométrie fine du trajet
réellement conduit, rééchantillonnée en densité variable selon la vitesse
(autoroute : un point tous les 50 m ; sections lentes : tous les 10 m), avec
un PR intermédiaire (`pk`) recalculé pour chaque point par projection sur le
corridor IGN de data/csv/road_pr.csv.

Invariant clé : le `pk` émis reste dans le référentiel pk_cum du corridor IGN.
Les `pkRange` et les `waypoints` de js/car-config.js restent donc valides sans
modification — seule la géométrie entre les PR devient fidèle à la route
(les PR IGN espacés d'environ 1 km cordent les courbes, jusqu'à plusieurs
centaines de mètres d'écart dans les gorges de Nantua).

Deux sortes d'interruptions de rattachement, traitées différemment :
- vrai trou GPS (tunnel, perte de signal — saut spatial entre deux fixes
  consécutifs) : la trace y trace une corde fausse, l'intervalle est comblé
  par les points IGN d'origine (colonne `source` = pr), de même que les
  portions de corridor non couvertes (avant la prise d'autoroute, après la
  sortie) ;
- artefact de projection (fixes contigus mais cordes IGN trop éloignées de
  la route réelle, typiquement les lacets de la D1212 où la projection
  saute plusieurs PR d'un fixe au suivant) : on garde la géométrie réelle
  de la trace et le pk y est interpolé sur la distance parcourue entre les
  deux tronçons rattachés qui bornent l'intervalle (`source` = trace).

Usage (depuis la racine du dépôt) :
    python3 python/refine_corridors.py [chemin/vers/trace.csv]

La trace attendue (défaut data/raw/gps/trajet_gps_nettoye.csv, non versionnée —
voir data/raw/README.md) : CSV `time;Latitude;Longitude;Vitesse (km/h)`,
délimiteur point-virgule, vitesse parfois vide.
"""

import csv
import math
import os
import sys
import tempfile

TRACE_DEFAULT = "data/raw/gps/trajet_gps_nettoye.csv"
CORRIDOR_CSV = "data/csv/road_pr.csv"
OUTPUT = "data/csv/road_trace.csv"

CORRIDOR_IDS = ["a406", "a40", "d1212"]

# Densité de rééchantillonnage : espacement (km) selon la vitesse au point.
FAST_SPEED_KMH = 80.0
SPACING_FAST_KM = 0.050   # 20 pts/km au-dessus de 80 km/h
SPACING_SLOW_KM = 0.010   # 100 pts/km en dessous

# Un point de trace est rattaché au corridor si sa projection en est à moins
# de cette distance. Large à dessein : les cordes entre PR IGN (~1 km)
# s'écartent de la route réelle dans les courbes serrées — jusqu'à ~650 m
# dans les lacets de la D1212, d'où sa tolérance spécifique.
MATCH_TOLERANCE_KM = {"a406": 0.40, "a40": 0.40, "d1212": 0.70}
# Une interruption de rattachement plus longue que ce saut de pk (ou un trou
# spatial entre deux fixes consécutifs) bascule sur les points IGN.
GAP_PK_KM = 0.60
GAP_FIX_KM = 0.30
# Un tronçon rattaché plus court est ignoré (accrochage fortuit d'une route
# parallèle au corridor).
MIN_RUN_PK_KM = 0.50


def dist_km(a_lat, a_lon, b_lat, b_lon):
    # Équirectangulaire, suffisant à ces échelles (< 1 km)
    kx = 111.32 * math.cos(math.radians((a_lat + b_lat) / 2))
    return math.hypot((a_lat - b_lat) * 111.32, (a_lon - b_lon) * kx)


def load_corridors(path):
    corridors = {cid: [] for cid in CORRIDOR_IDS}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cid = row["corridor"]
            if cid not in corridors:
                continue
            corridors[cid].append((float(row["pk_cum"]), float(row["Y"]), float(row["X"])))
    for cid, pts in corridors.items():
        pts.sort(key=lambda p: p[0])
        if len(pts) < 2:
            sys.exit(f"Corridor {cid} introuvable ou trop court dans {path}")
    return corridors


def load_trace(path):
    """[(lat, lon, vitesse_kmh)] — vitesse manquante interpolée depuis les voisines."""
    pts = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            lat = float(row["Latitude"])
            lon = float(row["Longitude"])
            raw = (row.get("Vitesse (km/h)") or "").strip()
            v = float(raw) if raw else None
            pts.append([lat, lon, v])
    # Comblement des vitesses manquantes : dernière valeur connue, sinon la
    # première connue (début de trace).
    last = None
    for p in pts:
        if p[2] is None:
            p[2] = last
        else:
            last = p[2]
    first = next((p[2] for p in pts if p[2] is not None), 0.0)
    for p in pts:
        if p[2] is None:
            p[2] = first
    return [tuple(p) for p in pts]


def project_on_corridor(corridor, lat, lon):
    """Projette un point sur la polyligne du corridor → (pk interpolé, distance km)."""
    best_pk, best_d = None, float("inf")
    for i in range(len(corridor) - 1):
        pk_a, la_a, lo_a = corridor[i]
        pk_b, la_b, lo_b = corridor[i + 1]
        kx = 111.32 * math.cos(math.radians((la_a + la_b) / 2))
        ax, ay = lo_a * kx, la_a * 111.32
        bx, by = lo_b * kx, la_b * 111.32
        px, py = lon * kx, lat * 111.32
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d < best_d:
            best_d = d
            best_pk = pk_a + t * (pk_b - pk_a)
    return best_pk, best_d


def match_runs(cid, corridor, trace):
    """Découpe la trace en tronçons contigus rattachés au corridor.

    Retourne une liste de "runs" : listes de (idx, lat, lon, vitesse, pk),
    idx = index du fixe dans la trace (pour le pontage entre runs), pk rendu
    monotone croissant (le bruit latéral peut faire reculer la projection).
    """
    projected = []
    for lat, lon, v in trace:
        pk, d = project_on_corridor(corridor, lat, lon)
        projected.append((lat, lon, v, pk, d))

    runs = []
    current = []
    for i, (lat, lon, v, pk, d) in enumerate(projected):
        ok = d <= MATCH_TOLERANCE_KM[cid]
        if ok and current:
            prev = current[-1]
            # Coupure sur trou spatial (perte GPS) ou saut/retour de pk
            # (aller-retour, bretelle) : la corde du trou n'est pas la route.
            if (dist_km(prev[1], prev[2], lat, lon) > GAP_FIX_KM
                    or pk < prev[4] - GAP_PK_KM or pk > prev[4] + GAP_PK_KM):
                runs.append(current)
                current = []
        if ok:
            current.append((i, lat, lon, v, pk))
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)

    kept = []
    for run in runs:
        # pk monotone dans le run
        mono = []
        for idx, lat, lon, v, pk in run:
            if mono and pk < mono[-1][4]:
                pk = mono[-1][4]
            mono.append((idx, lat, lon, v, pk))
        if mono[-1][4] - mono[0][4] >= MIN_RUN_PK_KM:
            kept.append(mono)
    # Ordre le long du corridor + fusion : on ne garde qu'une progression
    # strictement croissante en pk (un trajet ne repasse pas en arrière).
    kept.sort(key=lambda r: r[0][4])
    merged = []
    for run in kept:
        if merged and run[0][4] < merged[-1][-1][4]:
            run = [p for p in run if p[4] > merged[-1][-1][4]]
            if not run or run[-1][4] - run[0][4] < MIN_RUN_PK_KM:
                continue
        merged.append(run)
    return merged


def chain_runs(runs, trace):
    """Fusionne les runs séparés par un simple artefact de projection.

    Deux runs consécutifs sont pontés quand la trace est continue entre eux
    (aucun saut spatial > GAP_FIX_KM ni retour arrière d'index) : les fixes
    intermédiaires sont conservés tels quels, leur pk interpolé sur la
    distance parcourue entre la fin du run amont et le début du run aval.
    Un vrai trou GPS laisse deux chaînes distinctes (comblées ensuite en IGN).
    """
    def contiguous(i0, i1):
        for i in range(i0, i1):
            if dist_km(trace[i][0], trace[i][1], trace[i + 1][0], trace[i + 1][1]) > GAP_FIX_KM:
                return False
        return True

    chains = []
    for run in runs:
        if chains:
            prev = chains[-1]
            i0, pk0 = prev[-1][0], prev[-1][4]
            i1, pk1 = run[0][0], run[0][4]
            if i1 > i0 and pk1 > pk0 and contiguous(i0, i1):
                # Pont : fixes stricts entre i0 et i1, pk réparti à la distance
                bridge = []
                cum = [0.0]
                for i in range(i0, i1):
                    cum.append(cum[-1] + dist_km(trace[i][0], trace[i][1],
                                                 trace[i + 1][0], trace[i + 1][1]))
                total = cum[-1]
                for j, i in enumerate(range(i0 + 1, i1)):
                    lat, lon, v = trace[i]
                    t = cum[j + 1] / total if total > 0 else 0.0
                    bridge.append((i, lat, lon, v, pk0 + t * (pk1 - pk0)))
                prev.extend(bridge)
                prev.extend(run)
                continue
        chains.append(list(run))
    return chains


def resample_run(run):
    """Rééchantillonne un run le long de sa polyligne, espacement selon vitesse.

    Le pk de chaque échantillon est interpolé linéairement (en distance
    parcourue) entre les pk projetés des fixes qui le bornent : les PR
    intermédiaires suivent ainsi exactement la géométrie de la trace.
    """
    if len(run) < 2:
        return []
    cum = [0.0]
    for i in range(1, len(run)):
        cum.append(cum[-1] + dist_km(run[i - 1][1], run[i - 1][2], run[i][1], run[i][2]))
    total = cum[-1]
    if total <= 0:
        return []

    samples = []
    s = 0.0
    i = 0
    while s <= total:
        while i < len(run) - 2 and cum[i + 1] < s:
            i += 1
        seg = cum[i + 1] - cum[i]
        t = 0.0 if seg == 0 else (s - cum[i]) / seg
        lat = run[i][1] + t * (run[i + 1][1] - run[i][1])
        lon = run[i][2] + t * (run[i + 1][2] - run[i][2])
        v = run[i][3] + t * (run[i + 1][3] - run[i][3])
        pk = run[i][4] + t * (run[i + 1][4] - run[i][4])
        samples.append((pk, lat, lon, v))
        s += SPACING_FAST_KM if v > FAST_SPEED_KMH else SPACING_SLOW_KM
    # Dernier fix du run (borne exacte de la couverture trace)
    last = run[-1]
    samples.append((last[4], last[1], last[2], last[3]))
    return samples


def refine_corridor(cid, corridor, trace):
    """Fusionne trace rééchantillonnée et points IGN de comblement, triés par pk."""
    chains = chain_runs(match_runs(cid, corridor, trace), trace)
    rows = []
    covered = []
    for chain in chains:
        for pk, lat, lon, v in resample_run(chain):
            rows.append((pk, lat, lon, v, "trace"))
        covered.append((chain[0][4], chain[-1][4]))

    for pk, lat, lon in corridor:
        if any(a - 1e-9 <= pk <= b + 1e-9 for a, b in covered):
            continue
        rows.append((pk, lat, lon, None, "pr"))

    rows.sort(key=lambda r: r[0])
    # pk strictement croissant (jonctions run/IGN)
    out = []
    for pk, lat, lon, v, src in rows:
        if out and pk <= out[-1][0]:
            continue
        out.append((pk, lat, lon, v, src))
    return out, covered


def main():
    trace_path = sys.argv[1] if len(sys.argv) > 1 else TRACE_DEFAULT
    if not os.path.exists(trace_path):
        sys.exit(f"Trace GPS introuvable : {trace_path} (voir data/raw/README.md)")

    corridors = load_corridors(CORRIDOR_CSV)
    trace = load_trace(trace_path)

    all_rows = []
    for cid in CORRIDOR_IDS:
        route_label = {"a406": "A406", "a40": "A40", "d1212": "D1212"}[cid]
        rows, covered = refine_corridor(cid, corridors[cid], trace)
        n_trace = sum(1 for r in rows if r[4] == "trace")
        n_pr = len(rows) - n_trace
        cov = ", ".join(f"[{a:.1f}, {b:.1f}]" for a, b in covered)
        print(f"{cid}: {len(rows)} pts ({n_trace} trace + {n_pr} pr), couverture trace pk {cov}")
        for pk, lat, lon, v, src in rows:
            all_rows.append((cid, route_label, pk, lat, lon, v, src))

    # Écriture atomique : fichier temporaire puis remplacement.
    out_dir = os.path.dirname(OUTPUT)
    fd, tmp = tempfile.mkstemp(dir=out_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["corridor", "route", "pk", "lat", "lon", "speed_kmh", "source"])
            for cid, route_label, pk, lat, lon, v, src in all_rows:
                w.writerow([cid, route_label, f"{pk:.5f}", f"{lat:.6f}", f"{lon:.6f}",
                            "" if v is None else f"{v:.0f}", src])
        os.replace(tmp, OUTPUT)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    print(f"→ {OUTPUT} : {len(all_rows)} lignes")


if __name__ == "__main__":
    main()
