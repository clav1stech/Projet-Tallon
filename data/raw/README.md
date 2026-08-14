# Données brutes (`data/raw/`) — catalogue

⚠️ **Fichiers volumineux (~175 Mo), NON versionnés** (`.gitignore` : `data/raw/*`, seul ce
README est suivi), **jamais précachés par le service worker**, et **à ne jamais parser
intégralement** (coût token/mémoire) : lire ce catalogue ; au besoin, sonder avec
`head -3`, un one-liner python, ou régénérer les schémas via `python3 python/profile_raw.py`.

Les fichiers exploitables par l'app sont **générés** dans `data/csv/` (légers, versionnés) :

| Script | Source | Sortie |
|---|---|---|
| `python3 python/extract_pk.py` | `rail/pks 2.csv` | `data/csv/rail_pk.csv` (lignes 752000/752100/752330/830000/893000, toutes colonnes) |
| `python3 python/extract_pr.py` | `road/pr-*.csv` | `data/csv/road_pr.csv` (corridors a406/a40/d1212, toutes colonnes + `pk_cum`) |
| `python3 python/refine_corridors.py` | `gps/trajet_gps_nettoye.csv` + `data/csv/road_pr.csv` | `data/csv/road_trace.csv` (géométrie fine des corridors, PR interpolés) |

Relancer ces scripts si d'autres lignes SNCF / corridors routiers sont ajoutés
(éditer `--lines` ou la liste `CORRIDORS` en tête de script).

---

## rail/pks 2.csv — 30 Mo, 366 397 lignes, 1005 codes ligne

- **Source** : SNCF Open Data — PK géolocalisés du réseau ferré national.
- **Schéma** : `"code_ligne","pk","vitesse","altitude","altitude_tunnels","altitude_declivites","lat","lon"`
  — délimiteur virgule, champs quotés, point décimal, `NULL` littéral, `pk` en km décimaux
  (**valeurs négatives possibles**, ex. -0.8).
- **Lignes utiles à l'app** (code_ligne des points de `masterRoutes.normalized.json`) :
  752000 (LGV Sud-Est, 7113 pts), 752100 (raccordement, 395 pts), 752330
  (accès Montanay–Lyon-Saint-Clair), 830000 et 893000 (accès Lyon-Part-Dieu).
- ✅ **Utilisé** : source de `data/csv/rail_pk.csv` ; le descripteur `data/datasets/rail-pk.json`
  filtre la 752000 pour l'affichage PK d'index.html.
- 🔮 **Futur** : `vitesse` (vitesse de ligne au PK courant), `altitude`/`altitude_declivites`
  (profil altimétrique) — colonnes déjà présentes dans le CSV extrait, aucune ré-extraction nécessaire ;
  corridors multi-lignes (752100/830000 déjà extraits, sélectionnables par le filtre du descripteur).

## rail/lignes-vitesses.geojson — 25 Mo, 2469 LineString

- **Propriétés** : `code_ligne, v_max, lib_ligne, pkd, pkf, pkd_arrondi, pkf_arrondi`
  (vitesse max par plage de PK [pkd, pkf] d'une ligne).
- 🔮 **Futur** : afficher la v_max au PK courant (comparaison vitesse GPS / limite de ligne).
  Extraction envisagée : filtrer par `code_ligne`, ne garder que `(code_ligne, v_max, pkd, pkf)`
  → table de lookup légère (les géométries LineString, volumineuses, sont inutiles :
  le PK courant vient déjà du corridor).

## rail/lignes-tunnels.geojson — 1,5 Mo, 1469 LineString

- **Propriétés** : `code_ligne, obstacle, libelle, longueur (m), pkd, pkd_arrondi`.
- 🔮 **Futur** : « tunnel X dans Y km », prédiction de perte GPS (couper les alertes
  de précision quand un tunnel est attendu au PK courant + le mode dégradé sait pourquoi).

## rail/localites.geojson — 1,9 Mo, 5352 Points

- **Propriétés** : `code, libelle, code_uic, code_ligne, pk, lignePK, fret, voyageurs,
  commune, departement, code_departement, region, tvs`.
  `lignePK` = PK de la localité sur PLUSIEURS lignes (ex. `"570000 / 449.384, 579000 / 68.112"`).
- 🔮 **Futur** : enrichissement automatique des points nommés de masterRoutes (PK/UIC des gares),
  bascule de ligne aux bifurcations via `lignePK`.

## road/pr-national-autoroutes.csv — 9,2 Mo, 48 854 lignes

- **Source** : IGN BD TOPO — points de repère routiers (autoroutes), WGS84.
- **Schéma** : `X, Y, gml_id, cleabs, date_*, sources, identifiants_sources, route, numero,
  abscisse, ordre, cote, statut, type_de_pr, libelle, identifiant_de_section,
  code_insee_du_departement, lien_vers_route_nommee, gestionnaire`.
- **Pièges** :
  - PR dupliqués par chaussée (`cote` G/D, ~15 m d'écart) avec des `identifiant_de_section`
    **disjoints** entre G et D → dédupliquer par `(numero, gestionnaire)`.
  - `abscisse` **redémarre à chaque section** ; la numérotation PR de l'A40 n'est **pas monotone**
    de Mâcon au Fayet (APRR PR 102→207 puis ATMB PR 102→0). D'où le `pk_cum` (km cumulés,
    ordre géométrique reconstruit par chaînage plus-proche-voisin) émis par `extract_pr.py`.
  - Lignes `statut = "Calculé"` (`type_de_pr` DS/FS) = bornes techniques de section, à écarter.
- ✅ **Utilisé** : corridors `a406` (10 pts, 8,8 km) et `a40` (206 pts, 200,6 km) de
  `data/csv/road_pr.csv`.
- 🔮 **Futur** : affichage du PR réel (`numero` conservé dans le CSV extrait), autres autoroutes.

## gps/trajet_gps_nettoye.csv — ~180 Ko, 3 382 lignes

- **Source** : enregistrement GPS réel du trajet Mâcon → Combloux (juillet 2026), nettoyé.
- **Schéma** : `time;Latitude;Longitude;Vitesse (km/h)` — délimiteur point-virgule,
  point décimal, vitesse parfois vide (interpolée par le script), fixes toutes les 1–3 s.
- **Pièges** : trous GPS dans les tunnels et sur Châtillon→Bellegarde (~12,6 km sans fixe) —
  la corde d'un trou n'est PAS la route, `refine_corridors.py` y replie sur les PR IGN.
- ✅ **Utilisé** : source de `data/csv/road_trace.csv` (géométrie fine des corridors du mode
  voiture : 1 pt/50 m > 80 km/h, 1 pt/10 m en dessous, PR interpolés sur le référentiel
  `pk_cum` de `road_pr.csv`).
- 🔮 **Futur** : re-tracer d'autres itinéraires en déposant une nouvelle trace au même format
  (`python3 python/refine_corridors.py chemin/vers/trace.csv`).

## road/pr-departemental.csv — 109 Mo, 550 067 lignes

- **Source/Schéma** : identiques au fichier autoroutes (IGN BD TOPO, routes départementales).
  ⚠️ Le plus gros fichier du dépôt — toujours streamer.
- ✅ **Utilisé** : corridor `d1212` (D1212 dépt 74, 20 pts, 16,4 km, Sallanches PR 0 → Megève ;
  le trajet Combloux n'utilise que [0, 5.3] km via le `pkRange` du leg).
- 🔮 **Futur** : autres départementales (filtrer `route` + `code_insee_du_departement`
  dans `CORRIDORS` de `extract_pr.py`).
