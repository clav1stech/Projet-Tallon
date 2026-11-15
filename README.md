# Projet-Tallon — Railway Timeline

Application web statique de suivi de trajet TGV en temps réel : position par
GPS ou WiFi SNCF, comparée à un horaire théorique pour afficher le retard (ou
l'avance) en direct, point de passage par point de passage.

**Version courante (`main`) : v2.4.1** — voir [CHANGELOG.md](CHANGELOG.md)
pour l'historique complet.

> Les branches de chantier (non encore mergées sur `main`) ajoutent le mode
> voiture, le mode hors-ligne (PWA), le conteneur iOS et l'unification des deux
> modes de transport. Les sections **Mode voiture** et **Architecture**
> ci-dessous décrivent l'état de la branche courante.

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
    voir listener `SNCF_GPS_BRIDGE` dans `js/app.js`),
  - **app iOS** (`ios/`) : la même interface dans une WKWebView, avec accès
    natif à l'API WiFi SNCF (sans CORS), contrôle de fraîcheur, repli GPS et
    retour automatique au WiFi SNCF. IPA non signé produit par GitHub Actions,
    installé depuis Windows avec Sideloadly — voir
    [docs/ios-sideloadly.md](docs/ios-sideloadly.md).
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
- **Éditeur cartographique rail** (`train-points-editor.html`) pour déplacer
  les points sur un fond OpenRailwayMap. Les bifurcations distinguent les
  coordonnées V1 (Paris → Province) et V2 (Province → Paris), avec une vue
  simultanée des deux voies et un export du schéma v3 validé. Les tunnels et
  ouvrages d'art ont eux aussi une entrée par sens ; lorsque leur longueur est
  connue, leur seconde extrémité et leur emprise suivent la polyline ferroviaire.

## Mode voiture (`car.html`)

Second mode de transport de la même application : suivi d'un trajet Mâcon ⇄
Combloux le long des corridors A406 / A40 / D1212, en **progression + distance
restante** — ni gares, ni horaire théorique, ni heure d'arrivée, ni retard. Il
partage avec le train la mise en page, le cycle de session, le carrousel et le
profil de vitesse, et garde son identité bleu nuit et ses données propres
(géométrie de corridor issue d'une trace GPS réelle).

- **Passage d'un mode à l'autre** : un lien discret en tête des réglages de
  chaque mode (« Voiture ⇄ » / « Train ⇄ »), accessible depuis l'accueil comme
  depuis le cockpit via « Réglages ». Chaque mode est une page, avec son
  manifeste PWA, son état et ses préférences : changer de mode décharge
  l'ancienne page et sa géolocalisation avec elle. Si un suivi est en cours,
  une confirmation le termine proprement avant de partir ; les réglages des
  deux modes restent mémorisés séparément et aucune session n'est reprise au
  retour. Le conteneur iOS rouvre le dernier mode utilisé.
- **Accueil** : trajet choisi, départ, destination, distance totale, sens et
  secteurs géographiques traversés (Mâconnais, Bresse, Bugey, Titans,
  Bellegarde, Genevois, Arve, Mont-Blanc) avec leur longueur. Un bouton
  inverse le sens. Les péages, tunnels et sorties n'y figurent pas : ils
  appartiennent au suivi.
- **Session** : lancement explicite, retour aux réglages sans interrompre le
  GPS, itinéraire provisoire à appliquer ou annuler, reprise sans remise à
  zéro. Un changement effectif d'itinéraire ne réinitialise que la progression
  et les statistiques liées à l'ancien trajet ; l'acquisition GPS continue.
- **Cockpit** (portrait et paysage) : compteur de vitesse calibré pour la
  route (150 km/h), **secteur géographique courant** avec transition au
  changement, pourcentage et distance restante, prochain repère et sa
  distance, état du signal GPS, distances parcourue et restante, vitesses
  moyenne et maximale, profil de vitesse (trajet entier ou 15 dernières
  minutes) et détail des repères.
- **Carrousel routier** : progression continue entre les repères, tête de
  lecture interpolée, défilement libre au toucher, à la souris et au clavier
  (le suivi automatique se suspend, un bouton recentre). Points de passage
  typés — sorties, échangeurs, aires, cols, viaducs, tunnels et barrières de
  péage (Val de Saône, Viry, Nangy, Cluses) — chacun avec son **icône** ; les
  péages et les extrémités du trajet sont mis en avant. Un ouvrage d'art reste
  le repère visé pendant tout son franchissement, avec une jauge.
- **Deux sens** : les corridors sont tracés dans le sens aller et parcourus à
  rebours au retour (`reverse`) ; les repères et secteurs sont partagés sans
  duplication, avec un PK retour distinct lorsque les deux chaussées divergent.
- **Progression le long de la route** : PK interpolé et distances restantes
  mesurées le long du corridor (et non à vol d'oiseau).
- **GPS routier réactif** : flux continu, vitesse native du téléphone quand
  elle est disponible. Si le signal disparaît à l'entrée d'un tunnel déclaré,
  la progression continue à la vitesse d'entrée jusqu'à la sortie théorique,
  puis pendant 10 secondes de raccrochage avant d'être figée. Durant cette
  estimation, `assets/tunnel.png` remplace la vitesse, la position est
  libellée « estimée » (compteur, état du signal, tête de lecture, barre de
  progression) et le profil de vitesse reste interrompu : une progression
  extrapolée n'est jamais présentée comme une mesure. Une perte hors tunnel
  est affichée séparément et suspend immédiatement la progression.
- **Éditeur cartographique** (`car-points-editor.html`) : visualisation du
  tracé et des points de passage sur OpenStreetMap, déplacement par glisser,
  recalage automatique sur la route, projection spatiale de la longueur des
  tunnels et viaducs à partir de leur repère propre au sens sélectionné,
  application locale et export/import JSON. Une troisième option affiche et
  édite les deux sens simultanément : les repères sont différenciés par couleur
  et ceux qui se confondent sont légèrement écartés perpendiculairement au
  tracé pour rester cliquables. Les projections aller/retour sont comparées
  automatiquement avec une tolérance de 50 m et les écarts sont signalés.
  La projection suit le sens sélectionné : vers l'est à l'aller et vers
  l'ouest au retour.

Les données d'itinéraire vivent dans `js/car-config.js` (source unique,
comme `routes-config.js` pour le rail) ; toute route ou tout point de passage
ajouté y apparaît automatiquement dans le sélecteur.

## Architecture

Application 100 % statique, sans backend ni build (modules ES natifs
`<script type="module">`, aucun bundler).

```
index.html              Page du mode train (accueil + cockpit)
car.html                 Page du mode voiture (accueil + cockpit, Mâcon ⇄ Combloux)
car-points-editor.html   Carte de contrôle et correction des points voiture
train-points-editor.html Carte de contrôle et correction des points rail
master-editor.html       Éditeur visuel des trajets (data/masterRoutes.normalized.json)
css/train.css            Mise en page commune aux deux modes (accueil, cockpit, carrousel)
css/car.css              Thème bleu nuit et éléments routiers, par-dessus train.css
css/styles.css           Styles des éditeurs (master, points rail, points voiture)
css/train-points-editor.css Styles dédiés à l'éditeur cartographique rail
sw.js                    Service worker : cache hors-ligne (stale-while-revalidate)
manifest.webmanifest     Manifeste PWA du mode train (installation plein écran iPhone)
car.webmanifest          Manifeste PWA du mode voiture

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
  train-config.js        Réglages du mode train (session, perte de signal, bornes ΔT)
  trip-config.js         Configuration de trajet pure : plan horaire, synthèse de desserte
  tracking-session.js    Session de tracking sans DOM : acquisition, accrochage au trajet,
                          rejeu, modèles de données (cockpit, profil de vitesse)
  train-controller.js    Transitions navigation / configuration provisoire / appliquée / session
  train-profile.js       Réduction du tracé de vitesse par colonne de pixels
  ui.js                  Rendu train : accueil éditable, cockpit, horaires, passages
  app-mode.js            Modes de transport : pages, dernier mode, reprise au lancement iOS
  app-shell.js           Coquille DOM commune : aides de rendu, bandeau, changement de mode
  session-flow.js        Règles communes du cycle de session (lancer / appliquer / reprendre)
  carousel-view.js       Carrousel commun : ligne, tête de lecture, suivi, recentrage
  speed-profile-view.js  Tracé et inspection du profil de vitesse, communs aux deux modes
  app.js                 Orchestration rail : écouteurs DOM, boucle de tracking,
                          bascule GPS / WiFi SNCF / bridge Scriptable / bridge iOS
  sncf-telemetry.js      Télémétrie WiFi SNCF pure : lecture des réponses, fraîcheur,
                          repli GPS et retour au WiFi SNCF
  routes-config.js        MAIN_ROUTES — source unique des trajets rail proposés,
                          partagée entre l'app et l'éditeur
  car-config.js           CAR_ROUTES — source unique des itinéraires voiture (aller/retour)
  car-route.js            Construction de la route voiture hybride (corridor PK +
                          waypoints), secteurs et distances — logique pure, testable
  car-session.js          Session voiture sans DOM : itinéraire provisoire / appliqué,
                          sens, préférences, statistiques du trajet
  car-ui.js               Rendu voiture : accueil, cockpit, secteurs, repères et ouvrages
  car-app.js              Orchestration voiture (acquisition GPS, matching, tunnels)
  car-waypoint-overrides.js Surcouche locale/exportable des corrections cartographiques
  car-points-editor.js    Carte interactive et recalage des repères sur le corridor
  master-routes-data.js   Chargement, validation et export partagés du schéma v3
  train-points-model.js   Lecture/écriture des coordonnées communes et V1/V2
  train-structure-endpoints.js Projection des ouvrages sur la polyline ferroviaire
  train-map-polyline.js   Reconstruction des trajets sur les corridors ferroviaires
  train-points-editor.js  Carte rail, repères déplaçables et vue des deux voies
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

tests/                    Suite Vitest (fonctions pures : moteur, corridors, route voiture,
                          sessions des deux modes) ; tests/browser/ : harnais navigateur
                          train-ui.html et car-ui.html

ios/                      Conteneur iOS (Swift + WKWebView, projet XcodeGen) :
                          pages embarquées depuis la liste de précache de sw.js,
                          bridge natif wifi.sncf — voir docs/ios-sideloadly.md
```

Voir [agent.md](agent.md) et [CONVENTIONS.md](CONVENTIONS.md) pour les
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

Pour corriger uniquement leur placement géographique, ouvrir
`train-points-editor.html`. Le fond OpenRailwayMap est superposé à
OpenStreetMap et nécessite une connexion réseau. Une bifurcation déplacée sur
V1 ou V2 conserve une coordonnée propre à ce sens. Il en va de même pour les
tunnels et ouvrages d'art, dont l'extrémité V2 est proposée à partir de la
longueur connue et de la polyline ferroviaire dense. Les autres points gardent
une position commune. Le tracé rouge/bleu suit lui aussi cette polyline entre
les points, y compris lors d'un changement de ligne à une bifurcation. Les
accès `752330` vers Lyon-Saint-Clair et `893000` vers Lyon-Part-Dieu sont
inclus dans le jeu de corridors local. Les ouvrages sans longueur sont
signalés et leur entrée
V2 doit être placée manuellement ; l'export est refusé tant que les deux
extrémités ne sont pas distinctes ou si le schéma v3 n'est plus valide.

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
`agent.md` § Versionnage). Historique complet dans
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

Lire [agent.md](agent.md) et [CONVENTIONS.md](CONVENTIONS.md) avant toute
contribution (ces fichiers évoluent avec le projet, ne pas s'y fier comme
figés). Pas de commit ni de push sans validation explicite.

## Licence

[MIT](LICENSE)
