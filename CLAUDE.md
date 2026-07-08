# Projet Tallon — suivi de trajet TGV (+ mode voiture)

PWA 100 % statique en vanilla JS (modules ES, aucun bundler) : `index.html` (rail,
retard vs horaire théorique) et `car.html` (voiture, progression + ETA). Tests :
`npm test` (Vitest, fonctions pures uniquement). Service worker `sw.js` : incrémenter
`CACHE_VERSION` à chaque changement de fichier précaché.

## Architecture des données

- **Pattern descripteurs** : les CSV consommés par l'app sont décrits par
  `data/datasets/*.json` (délimiteur, mapping de colonnes, format PK, filtres) —
  parser générique `js/csv.js`, corridors `js/linearref.js`. Brancher/changer un
  fichier = éditer le descripteur, pas le code.
- `data/csv/` : fichiers légers **générés**, versionnés, précachés.
- `data/raw/` : fichiers sources volumineux (~175 Mo), **non versionnés**, jamais précachés.

## Règle : data/raw/

**NE JAMAIS lire intégralement les fichiers de `data/raw/`** (30–109 Mo chacun).
Lire d'abord `data/raw/README.md` : catalogue complet (schémas exacts, volumétrie,
pièges, usages présents/futurs). Si le catalogue ne suffit pas : `head -3`, un
one-liner python en streaming, ou `python3 python/profile_raw.py` (régénère les
schémas). Régénération des fichiers app : `python3 python/extract_pk.py` (rail),
`python3 python/extract_pr.py` (route).
