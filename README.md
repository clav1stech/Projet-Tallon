# Projet-Tallon — Railway Timeline

Application web statique de suivi de trajet TGV en temps réel : position par
GPS ou WiFi SNCF, comparée à un horaire théorique pour afficher le retard (ou
l'avance) en direct, point de passage par point de passage.

**Version courante (`main`) : v2.4.1** — voir [CHANGELOG.md](CHANGELOG.md)
pour l'historique complet.

> Un chantier de test actif existe sur la branche `dev/road-rail-route`
> (cible `v3.0.0`, **non encore mergée sur `main`**) : mode voiture avec HUD
> paysage, mode hors-ligne (PWA), données PK/PR réelles et suite de tests
> automatisés. Les sections **Mode voiture** et **Architecture** ci-dessous
> décrivent l'état de cette branche ; le reste correspond à `main`.

## Fonctionnalités

- **Sélection de trajet** : liste de trajets principaux (Paris ↔ Lyon-Part-Dieu,
  Mâcon, Marseille) avec arrêts intermédiaires optionnels (Le Creusot TGV,
  Mâcon-Loché TGV, Lyon-Saint-Exupéry TGV, Valence TGV, Avignon TGV,
  Aix-en-Provence TGV), sélectionnables indépendamment par case à cocher.
- **Suivi de position en temps réel** :
  - GPS natif du navigateur, ou
  - API WiFi SNCF (`wifi.sncf/router/api/train/gps`) avec bascule automatique
    vers le GPS natif en cas d'échec,
  - pont [Scriptable](https://scriptable.app/) pour iPhone (bypass CORS,
    voir listener `SNCF_GPS_BRIDGE` dans `js/app.js`).
- **Calcul de retard/avance** en continu par rapport à l'horaire théorique,
  avec pénalité d'arrêt en gare (6 min par arrêt intermédiaire) et lissage
  physique (accélération/décélération) sur les micro-trajets entre arrêts.
- **Décalage horaire global (ΔT)** réglable manuellement (± 30 min) pour
  recaler l'horaire théorique sur une annonce de retard connue au départ.
- **Timeline verticale** : liste des points de passage avec heure théorique,
  nom, et retard constaté à chaque point déjà franchi.
- **Widget de suivi** compact (dernier point franchi / prochain point +
  distances) et statut "On Time" / "Delay X min".
- **HUD paysage** (affiché automatiquement en rotation de l'écran) : compteur
  de vitesse circulaire, graphique de vitesse glissant (30 min), ETA
  recalculée, badge de retard, carousel vertical animé des points de passage
  avec horaires et retards.
- **Robustesse GPS** : garde-fou anti-téléportation (rejet des sauts de
  position physiquement impossibles), garde-fou unidirectionnel (l'index de
  segment ne recule jamais), lissage de vitesse par médiane glissante,
  gestion des bifurcations à deux voies (coordonnées différentes selon le
  sens de circulation).
- **Éditeur visuel de trajets** (`master-editor.html`) pour ajouter,
  réordonner ou éditer les points d'un trajet sans toucher au JSON à la main.

## Mode voiture (`car.html`, branche `dev/road-rail-route`)

Page autonome, miroir routier du mode rail : suivi d'un trajet Mâcon ⇄
Combloux le long des corridors A406 / A40 / D1212, en **progression + distance restante**
(pas de notion d'horaire théorique ni de retard). Réutilise le cœur partagé
avec le rail (fiabilité GPS, matching position → segment) mais avec une
géométrie de corridor issue d'une trace GPS réelle et des données propres.

- **Deux sens sélectionnables** : Mâcon → Combloux et Combloux → Mâcon depuis
  le même sélecteur. Les corridors sont tracés dans le sens aller et parcourus
  à rebours au retour (`reverse`) ; les repères et secteurs sont partagés sans
  duplication, avec un PK retour distinct lorsque les deux chaussées divergent.
- **HUD paysage** (rotation de l'écran) : compteur de vitesse circulaire
  calibré pour la route (150 km/h), graphe de vitesse glissant, distance
  restante, et carousel vertical animé des
  points de passage. À la place du badge de retard du rail, une **pilule de
  secteur géographique** (Mâconnais, Bresse, Bugey/Titans, Bellegarde,
  Genevois, Arve, Mont-Blanc).
- **Points de passage typés** : sorties, échangeurs, aires, viaducs, tunnels et
  barrières de péage (Val de Saône, Viry, Nangy, Cluses), chacun avec une
  **icône** distincte dans le widget et le HUD. La longueur des ponts et tunnels
  est visible dans la projection du trajet et dans l'éditeur cartographique.
- **Progression le long de la route** : PK interpolé et distances restantes
  mesurées le long du corridor (et non à vol d'oiseau).
- **GPS routier réactif** : flux continu, vitesse native du téléphone quand
  elle est disponible et bascule rapide sur une icône tunnel. Pendant la perte
  de signal, le graphe prolonge la dernière vitesse connue en pointillés.
- **Éditeur cartographique** (`car-points-editor.html`) : visualisation du
  tracé et des points de passage sur OpenStreetMap, déplacement par glisser,
  recalage automatique sur la route, projection spatiale de la longueur des
  tunnels et viaducs à partir de leur entrée dans le sens sélectionné,
  application locale et export/import JSON.

Les données d'itinéraire vivent dans `js/car-config.js` (source unique,
comme `routes-config.js` pour le rail) ; toute route ou tout point de passage
ajouté y apparaît automatiquement dans le sélecteur.

## Architecture

Application 100 % statique, sans backend ni build (modules ES natifs
`<script type="module">`, aucun bundler).

```
index.html              Page principale rail (sélection trajet + timeline + HUD)
car.html                 Page mode voiture (Mâcon ⇄ Combloux, HUD paysage)
car-points-editor.html   Carte de contrôle et correction des points voiture
master-editor.html       Éditeur visuel des trajets (data/masterRoutes.normalized.json)
css/styles.css           Tous les styles (dont HUD paysage rail + voiture, responsive)
sw.js                    Service worker : cache hors-ligne (stale-while-revalidate)
manifest.webmanifest     Manifeste PWA (installation plein écran iPhone)

js/
  state.js               État applicatif global (STATE) + persistance localStorage
  geo.js                 Géométrie pure (Haversine, projection sur segment)
  functions.js           Moteur de calcul pur : route effective, matching
                          position → segment, calcul de retard
  tracking.js            Helpers purs de fiabilité GPS (précision, anti-téléportation,
                          vitesse médiane, plancher de bruit, anti-pic)
  position-engine.js      Pipeline de fiabilité GPS réutilisable (compose tracking.js),
                          partagé rail / voiture
  csv.js / linearref.js   Parseur CSV générique + corridors PK/PR (référencement linéaire)
  ui.js                  Rendu DOM rail (timeline, widget, HUD paysage)
  app.js                 Orchestration rail : écouteurs DOM, boucle de tracking,
                          bascule GPS / WiFi SNCF / bridge Scriptable
  routes-config.js        MAIN_ROUTES — source unique des trajets rail proposés,
                          partagée entre l'app et l'éditeur
  car-config.js           CAR_ROUTES — source unique des itinéraires voiture (aller/retour)
  car-route.js            Construction de la route voiture hybride (corridor PK +
                          waypoints), secteurs et distances — logique pure, testable
  car-ui.js               Rendu DOM voiture (widget, HUD paysage, icônes waypoints)
  car-app.js              Orchestration voiture (boucle de tracking, matching)
  car-waypoint-overrides.js Surcouche locale/exportable des corrections cartographiques
  car-points-editor.js    Carte interactive et recalage des repères sur le corridor
  master-editor.js        Logique de master-editor.html
  fakeGeoSim.js           Simulateur GPS pour le développement (désactivé par défaut,
                          multiplicateur de vitesse + point de départ configurables)

data/
  masterRoutes.normalized.json   Schéma v3 : dictionnaire de points + trajets
  servicePatterns.json           Patterns de desserte nommés
  datasets/*.json                Descripteurs de CSV (délimiteur, colonnes, PK) pour csv.js
  csv/                            Fichiers légers versionnés (rail_pk, road_pr, road_trace)
  raw/                            Sources lourdes non versionnées (catalogue : raw/README.md)

python/
  export.py               Export texte versionné du projet (partage de contexte IA)
  extract_pk.py            Extraction de PK SNCF depuis un CSV brut (stdlib, streaming)
  extract_pr.py            Extraction des PR IGN BD TOPO pour les corridors routiers
  refine_corridors.py      Géométrie fine des corridors depuis une trace GPS réelle
  migrate_v2_to_v3.py      Migration ponctuelle du schéma de données (référence)

tests/                    Suite Vitest (fonctions pures : moteur, corridors, route voiture)
```

Voir [CLAUDE.md](CLAUDE.md) et [CONVENTIONS.md](CONVENTIONS.md) pour les
règles de contribution détaillées (où mettre quoi, non-régression, git).

### Flux de données

1. `app.js` charge `data/masterRoutes.normalized.json` et
   `data/servicePatterns.json` au démarrage.
2. La sélection utilisateur (trajet + arrêts) construit un pattern à la volée
   (`buildPatternFromSelection`), transformé en route effective par
   `buildEffectiveRoute` (durées par segment, pénalités d'arrêt, application
   du ΔT global).
3. Chaque position GPS/WiFi reçue passe par `computeSegmentIndexAndDistance`
   (localisation sur la route, garde-fous) puis `computeCurrentDelay`
   (retard courant), avant mise à jour de la timeline, du widget et du HUD.

## Installation / lancement

Aucune dépendance à installer pour l'app elle-même :

1. Cloner le dépôt.
2. Servir le dossier avec n'importe quel serveur statique (ouvrir
   `index.html` directement fonctionne aussi, mais un serveur local évite les
   restrictions CORS/fetch de certains navigateurs) :
   ```bash
   python3 -m http.server 8000
   # puis ouvrir http://localhost:8000
   ```
3. Sélectionner un trajet, une heure de départ, démarrer le suivi (`Start`).

### Éditer les trajets

Ouvrir `master-editor.html` (même serveur), modifier les points d'un trajet,
puis **Exporter JSON** pour récupérer le fichier mis à jour — les
modifications ne sont jamais écrites automatiquement sur disque.

### Tests

Suite [Vitest](https://vitest.dev/) sur les fonctions pures (moteur de
tracking, corridors PK/PR, construction de la route voiture). Nécessite les
dépendances de dev (`npm install`) :

```bash
npm test
```

### Scripts Python (`python/`)

Stdlib uniquement (aucune dépendance à installer), non interactifs, exécutés
manuellement hors production :
- `export.py` : export texte versionné du projet pour partage de contexte IA
  (version lue en tête de `CHANGELOG.md`, profils `ia`/`full` + mode `lite`).
- `extract_pk.py` : extrait les points kilométriques SNCF depuis un CSV brut
  (streaming) → `data/csv/rail_pk.csv`.
- `extract_pr.py` : extrait les PR IGN BD TOPO des corridors routiers →
  `data/csv/road_pr.csv`.
- `refine_corridors.py` : géométrie fine des corridors depuis une trace GPS
  réelle → `data/csv/road_trace.csv` (consommé par le mode voiture).
- `migrate_v2_to_v3.py` : migration one-off déjà appliquée, gardée pour
  référence (`--dry-run` disponible).

> **Ne jamais lire les sources de `data/raw/` en entier** (30–109 Mo chacune) :
> consulter d'abord le catalogue `data/raw/README.md`.

## État du projet / versionnage

Le versionnage suit [semver](https://semver.org/lang/fr/) strict (voir
`CLAUDE.md` § Versionnage). Historique complet dans
[CHANGELOG.md](CHANGELOG.md) ; points marquants :

- **v1.0.0** — refonte visuelle complète de l'interface.
- **v1.1.0** — éclatement du monolithe `main.js` initial en modules
  (`app.js`/`ui.js`/`state.js`/`utils.js`), ajout de l'ETA.
- **v2.0.0** — nouveau moteur de calcul de position + éditeur de master
  routes, réorganisation des données.
- **v2.1.0 → v2.4.1** — mode paysage (HUD), API WiFi train, éditeur revampé,
  bascule GPS/WiFi SNCF, carousel HUD, pont Scriptable iOS.

Un chantier séparé (`dev/road-rail-route`, cible `v3.0.0`, **non mergé sur
`main`**) ajoute un mode voiture complet (HUD paysage, itinéraires aller/retour,
secteurs, péages), un mode hors-ligne (PWA), une suite de tests automatisés et
un pipeline de données réelles (PK SNCF, corridors IGN). Ses commits de travail
ne bumpent pas le semver de `main` : la version ne sera consolidée en `v3.0.0`
qu'à la validation/merge. Voir le `CHANGELOG.md` de cette branche pour le détail.

## Contribution

Lire [CLAUDE.md](CLAUDE.md) et [CONVENTIONS.md](CONVENTIONS.md) avant toute
contribution (ces fichiers évoluent avec le projet, ne pas s'y fier comme
figés). Pas de commit ni de push sans validation explicite.

## Licence

[MIT](LICENSE)
