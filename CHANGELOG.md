# Changelog

## [Non publié] — Référencement PK et mode voiture (Mâcon → Combloux)

Branche : `claude/tgv-tracker-multi-mode-83nbkd`.

Objectif : préparer deux évolutions dont les fichiers CSV (PK ferroviaires,
PR autoroute A40) **ne sont pas encore disponibles** (colonnes inconnues) :
1. un enrichissement PK du mode rail (PK précis affiché en plus des points
   nommés, même page, même calcul de retard) ;
2. un mode voiture sur une URL séparée (`car.html`) pour le trajet
   Mâcon → Combloux (A40 par corridor PR + montée Sallanches → Combloux par
   projection sur segments droits), affichage progression + ETA.

Contrainte structurante : brancher les CSV réels plus tard **sans recoder**
— tout ce qui dépend de la forme des fichiers vit dans des descripteurs JSON.
Le mode rail existant est inchangé (les 57 tests historiques passent à
l'identique ; le CSV rail absent = no-op silencieux).

> **Release/tag** : recommandé de taguer l'état précédant cette section
> (ex: `v1.0.0`, commit `c11fac6`) puis l'état incluant cette section
> (ex: `v1.1.0`) — le diff entre les deux correspond exactement au périmètre
> décrit ici. Penser au bump `CACHE_VERSION` (fait : `tallon-v2`).

### Ajouts

#### Datasets CSV configurables par descripteurs JSON (`js/csv.js`, `data/datasets/*.json`)
**Cas d'usage : les CSV réels (PK rail, PR A40) arriveront plus tard, colonnes inconnues.**
Parseur CSV sans dépendance (guillemets, `""`, CRLF, lignes vides) + notion de
*descripteur de dataset* : un JSON par fichier déclarant chemin du CSV,
délimiteur, séparateur décimal, mapping des colonnes logiques
`{pk, line, lat, lon}` vers les colonnes réelles, format de PK (`plus` =
`123+456`, `decimal-km`, `meters`), filtres de lignes (`equals` / `oneOf`),
tri et décimation optionnelle (`everyNth`) pour les gros fichiers.
**Brancher un fichier réel = déposer le CSV + éditer le descripteur, zéro code.**
Deux descripteurs placeholder commis : `data/datasets/rail-pk.json` (colonnes
provisoires devinées d'après `python/extract_pk.py`) et
`data/datasets/a40-pr.json`. Erreurs typées (`DatasetError` :
`csv-missing`, `missing-column` avec liste des colonnes réellement présentes,
etc.) pour distinguer « fichier pas encore branché » d'un vrai bug.

#### Référencement linéaire PK (`js/linearref.js`)
**Cas d'usage : position exprimée en point kilométrique précis sur une ligne numérotée.**
Un CSV de PK est une polyline dense : le matching réutilise le moteur
existant `computeSegmentIndexAndDistance` **tel quel** (fenêtre glissante,
tolérance selon précision GPS, snap) — aucun nouveau moteur de projection.
`buildCorridor()` (filtrage, doublons, distances cumulées),
`locateOnCorridor()` (segment matché + PK interpolé PAR SEGMENT : un saut de
PK entre deux lignes ne contamine pas les voisins), `formatPk()`
(`123.456` → `"123+456"`). Le fallback par latitude est désactivé sur les
corridors (voir « Décisions » ci-dessous).

#### Moteur de position réutilisable (`js/position-engine.js`)
**Cas d'usage : partager la chaîne de fiabilité GPS entre rail et voiture sans duplication.**
`createPositionEngine()` compose les helpers PURS de `tracking.js` dans
l'ordre exact de la chaîne historique de `showPosition` : filtre de précision
(mode dégradé après disette) → anti-téléportation (ré-ancrage après 3 rejets)
→ historique 10 positions → vitesse médiane → plancher de bruit → anti-pic →
clamp (configurable : 350 km/h rail, 150 voiture). Options :
`trustReportedSpeed` (vitesse directe type WiFi SNCF), `speedDivisor`
(correction simulation fakeGeoSim). `app.js` (rail) conserve son
implémentation en place — non-régression garantie ; la bascule du rail sur ce
moteur reste une évolution optionnelle et isolée.

#### Mode voiture (`car.html`, `js/car-app.js`, `js/car-ui.js`, `js/car-config.js`, `js/car-route.js`)
**Cas d'usage : suivi du trajet Mâcon → Combloux en voiture.**
Nouvelle page autonome. Un itinéraire (`CAR_ROUTES`, miroir du pattern
`MAIN_ROUTES`) est une liste ordonnée de *legs* de deux types :
`pk-corridor` (tronçon autoroutier référencé PR via dataset — l'A40) et
`points` (waypoints manuels projetés sur segments droits, comme le rail —
la montée Sallanches → Combloux, coordonnées placeholder à affiner).
`buildCarRoute()` aplatit les legs en UNE route unique (jonctions
dédupliquées, distances cumulées, durées indicatives par `avgSpeedKmh`) que
les fonctions de matching existantes consomment telles quelles. Affichage :
tronçon courant, `PK 123+456 (A40)` ou prochain waypoint nommé, km
faits/restants + barre de progression, vitesse, **ETA = distance restante ÷
vitesse moyenne glissante** (120 derniers échantillons fiables, plancher
20 km/h — pas d'ETA infinie au péage). Pas de notion d'horaire/retard.
Un CSV placeholder `data/csv/a40_pr.csv` (~15 points approximatifs de l'A40)
rend la page démontrable avant le fichier réel ; compatible fakeGeoSim
(la simulation lit les `durationEffective` fournies par `buildCarRoute`).

#### Enrichissement PK du mode rail (`js/app.js`, `js/state.js`)
**Cas d'usage : afficher un PK précis en TGV, sans rien changer au suivi actuel.**
Au démarrage, `data/datasets/rail-pk.json` est chargé en non-bloquant : si le
CSV est présent, le PK interpolé (+ n° de ligne) s'ajoute à la ligne d'info
après chaque match réussi. **Purement informatif** : aucun couplage avec le
calcul de retard ni le matching des points nommés (endiguement du risque
volontaire). CSV absent = no-op silencieux, comportement strictement
identique à avant.

### Modifications

- `js/functions.js` : `export` ajouté à `buildSegmentCandidate` (réutilisé par
  `linearref.js`) ; nouveau paramètre optionnel `opts.disableLatitudeFallback`
  sur `computeSegmentIndexAndDistance` (défaut : comportement inchangé).
- `sw.js` : `CACHE_VERSION` → `tallon-v2` ; pré-cache de `car.html`, des 7
  nouveaux modules JS, des descripteurs et du CSV placeholder (hors-ligne sur
  l'A40 aussi). **À l'arrivée des CSV réels, les ajouter à `PRECACHE_URLS` et
  re-bumper `CACHE_VERSION`.**
- `js/state.js` : champs `railCorridor` / `railCorridorIndex` (reset à chaque
  rechargement de route).

### Décisions d'architecture

- **Aucune logique cardinale côté voiture.** Mâcon → Combloux est un trajet
  globalement **ouest-est** (Mâcon ~4,8°E → Combloux ~6,6°E, la variation de
  longitude domine largement celle de latitude) : `fallbackSegmentByLatitude`
  (pensé pour les LGV nord-sud) serait faux par construction et est **exclu**
  du mode voiture, même en dernier recours. Le filet de sécurité en cas
  d'échec temporaire du matching est **purement séquentiel** : on reste sur le
  dernier index validé et on ne reprend que vers l'avant — la densité du
  corridor PR (~100 m entre points) rend tout calcul de cap inutile.
- Pas de duplication du moteur de projection : corridor PK = polyline dense
  consommée par le matcher rail existant, PK obtenu par interpolation.
- Le garde-fou unidirectionnel, le seuil d'arrivée (0,2 km) et toute la
  chaîne de filtres GPS du rail sont conservés à l'identique côté voiture.

### Tests

Suite Vitest étendue : **119 tests, 8 fichiers** (les 57 historiques passent
inchangés) :
- `tests/csv.test.js` : délimiteurs `,`/`;`, guillemets/échappement, CRLF,
  virgule décimale, les 3 formats de PK, filtres `equals`/`oneOf`, décimation,
  erreurs typées (colonne non mappée / absente, descripteur ou CSV
  introuvable, dataset vide).
- `tests/linearref.test.js` : corridor synthétique ouest-est 50 points,
  interpolation PK (y compris discontinuité de PK au raccord de lignes),
  fenêtre autour de `lastIndex`, position hors corridor → `null` (preuve que
  le fallback latitude est bien désactivé), `formatPk` (arrondis au mètre).
- `tests/positionEngine.test.js` : rejet précision + mode dégradé 30 s,
  anti-téléportation avec ré-ancrage après 3 rejets, vitesse médiane limitée
  par l'anti-pic, plancher de bruit à l'arrêt, vitesse directe (WiFi SNCF),
  clamp voiture 150 km/h, correction `speedDivisor` (simulation).
- `tests/carRoute.test.js` : concaténation hybride corridor + waypoints
  (jonction dédupliquée), `cumKm` strictement croissant, PK présent uniquement
  sur le leg corridor, `durationEffective` depuis `avgSpeedKmh`, métadonnées
  de legs, erreurs de config ; ETA (nominal, plancher 20 km/h, échantillons
  non fiables ignorés, fenêtre glissante, cas dégénérés).

Vérification E2E (Chromium headless, serveur statique) : `index.html` se
comporte comme avant (7 trajets, timeline construite, message
`[PK] Corridor ferroviaire indisponible … no-op` en console) ; `car.html`
suit un trajet simulé complet — PK affiché le long de l'A40, bascule sur les
waypoints nommés dans la montée, arrivée détectée, barre à 100 %.

### Brancher les CSV réels (mode d'emploi, zéro code)

1. Déposer le fichier : `data/csv/rail_pk.csv` (rail) ou remplacer
   `data/csv/a40_pr.csv` (A40).
2. Ajuster le descripteur correspondant dans `data/datasets/` : `csv`
   (délimiteur, en-tête, séparateur décimal), `columns` (noms réels des
   colonnes), `pkFormat`, `filters` (ex: ne garder qu'un `code_ligne`).
3. Ajouter le CSV à `PRECACHE_URLS` (`sw.js`) et incrémenter `CACHE_VERSION`.
4. Recharger : le PK apparaît côté rail ; le corridor A40 réel remplace le
   placeholder côté voiture. En cas d'erreur de mapping, le message
   `DatasetError` liste les colonnes réellement présentes dans le fichier.

## [Non publié] — Mode hors-ligne (PWA) et localisation WiFi SNCF sur iPhone

### Ajouts

#### Service worker hors-ligne (`sw.js`, `manifest.webmanifest`, `index.html`)
**Cas d'usage : réseau instable / absent en TGV.**
La coquille applicative (HTML, CSS, JS, JSONs de routes, CSS font-awesome) est
pré-cachée à l'installation, puis servie en *stale-while-revalidate* : réponse
instantanée depuis le cache, mise à jour en arrière-plan. L'app se charge et
fonctionne intégralement sans réseau après la première visite. Les appels
temps réel (`wifi.sncf`) ne sont jamais mis en cache. Vérifié sous Chromium :
rechargement complet hors-ligne, données JSON servies depuis le cache.
Manifest + méta `apple-mobile-web-app-*` : l'app s'installe en PWA plein écran
sur iPhone (« Sur l'écran d'accueil »). Incrémenter `CACHE_VERSION` dans
`sw.js` à chaque déploiement pour purger l'ancien cache.

#### Bridge WiFi SNCF pour iPhone (`tools/scriptable-sncf-bridge.js`, `docs/wifi-sncf-iphone.md`)
Le listener `SNCF_GPS_BRIDGE` existait dans `app.js` mais sans script
compagnon. Ajout du script Scriptable qui ouvre l'app en WebView, interroge
nativement `https://wifi.sncf/router/api/train/gps` (hors CORS, impossible
depuis Safari) toutes les 2 s et injecte les positions via `postMessage`
(vitesse convertie m/s → km/h comme attendu par `showPosition`). Documentation
complète des options iPhone dans `docs/wifi-sncf-iphone.md`.

## [Non publié] — Robustesse du calcul de position (cas limites TGV)

Branche : `claude/tgv-position-edge-cases-lkgh0z` (issue de `Routes-v2`).

Objectif : rendre `computeSegmentIndexAndDistance`, `computeCurrentDelay` et
`showPosition` robustes face aux cas limites réels d'un trajet TGV, sans
casser le comportement existant (garde-fou unidirectionnel, fallback par
latitude, filtre anti-téléportation conservés).

### Corrections

#### 1. Fausse détection d'arrivée après un snap sur point (`functions.js`)
**Cas limite : sortie de tunnel / rebond de précision.**
Quand la position était trop loin de la ligne mais proche d'un point de
passage (< 900 m), le "snap sur le point le plus proche" retournait
`distanceToNextPointKm: 0`. Si le segment concerné était l'avant-dernier,
`showPosition` (seuil `< 0.2 km`) marquait le **terminus comme franchi** alors
que le train pouvait en être à plusieurs kilomètres. Le snap projette
désormais réellement la position sur le segment retenu et retourne les
distances exactes.

#### 2. Garde-fou unidirectionnel : distances incohérentes (`app.js`, `functions.js`)
**Cas limite : rebond GPS vers l'arrière.**
Quand l'index de segment était clampé pour ne pas reculer,
`distanceFromSegmentStart` restait celle mesurée sur le segment *rejeté* :
le calcul de retard mélangeait un index et une distance de deux segments
différents. Nouveau helper `projectPositionOnRouteSegment()` : les deux
distances sont reprojetées sur le segment forcé.

#### 3. Projection biaisée en longitude (`functions.js`)
`projectOnSegment` traitait les degrés de latitude et de longitude comme
équivalents. À ~46-48°N, 1° de longitude ≈ 0,68° de latitude en km : la
projection était biaisée sur les segments orientés est-ouest (jusqu'à ~30 %
d'erreur de ratio). Correction par facteur `cos(lat)` sur les composantes
longitude. Le seed du premier fix GPS (dans `showPosition`) utilisait la même
projection non corrigée ; il passe par le nouveau helper
`findNearestSegmentIndex()` qui applique la correction.

#### 4. Anti-téléportation : récupération après blocage (`tracking.js`, `app.js`)
**Cas limite : app suspendue par iOS puis réveillée ailleurs, ou dérive GPS
persistante.**
Le filtre anti-téléportation (> 2000 km/h, conservé à l'identique) pouvait
rejeter indéfiniment toutes les positions si le "vrai" déplacement paraissait
impossible par rapport à la dernière position de confiance. Nouveau
comportement (`evaluateTeleport`) : après 3 rejets consécutifs, le fix est
accepté et le tracking est ré-ancré (re-seed du segment le plus proche,
purge de l'historique de vitesse). Un fix cohérent remet le compteur à zéro.
Une longue perte GPS (tunnel) reste correctement acceptée dès le premier fix
car la vitesse implicite est calculée sur le temps réellement écoulé.

#### 5. Filtre de précision des fixes (`tracking.js`, `app.js`)
**Cas limite : rebond de précision post-tunnel (positionnement cellulaire).**
Aucun filtrage n'existait sur `coords.accuracy` : un fix à ±2500 m entrait
dans le pipeline (vitesse, segment, retard). Désormais (`shouldAcceptAccuracy`),
les fixes > 800 m de précision sont rejetés, **sauf** si aucun fix n'a été
accepté depuis 30 s (mode dégradé : dans un tunnel long, mieux vaut une
position approximative que rien). Les fixes sans précision renseignée
(WiFi SNCF, bridge Scriptable) restent acceptés.

#### 6. Vitesse fantôme à l'arrêt en gare (`tracking.js`, `app.js`)
**Cas limite : entrée en gare à faible vitesse / arrêt à quai.**
Le jitter GPS d'un train à l'arrêt (±30 m) produisait une vitesse médiane
fantôme de ~10 km/h affichée au HUD. Nouveau plancher de bruit
(`noiseFloorKmh`) : si la vitesse médiane est inférieure à la vitesse que le
seul bruit de précision peut produire sur la fenêtre d'observation, elle est
ramenée à 0.

#### 7. Gel du retard à l'arrivée (`app.js`)
**Cas limite : arrivée en avance (ou à l'heure) au terminus.**
Une fois le terminus franchi, `computeCurrentDelay` continuait de croître
tant que le train restait à quai (le temps réel avance, le temps théorique
est figé). Le retard affiché est désormais gelé à la valeur constatée au
moment du franchissement du terminus — une avance reste une avance.

#### 8. Durcissement de `computeCurrentDelay` (`functions.js`)
- `segmentIndex` hors bornes (terminus affiché, route rechargée) : clampé au
  lieu de lire `route[segmentIndex]` indéfini (crash `TypeError`).
- `segmentIndex` `NaN` : retourne 0.
- `distanceFromStart` `NaN` : traitée comme 0 (aucun `NaN` propagé au HUD).

#### 9. Nettoyage
- Suppression d'un bloc mort inatteignable dans
  `computeSegmentIndexAndDistance` (second `if (!bestCandidate)`).
- Extraction de la logique pure de `showPosition` (médiane de vitesse,
  anti-pic, guards) vers `js/tracking.js` : testable hors navigateur, sans
  DOM ni GPS réel — conformément à la contrainte « tests hors conditions
  réelles ».

### Comportements volontairement conservés
- Garde-fou unidirectionnel (l'index de segment ne recule jamais).
- Fallback par latitude quand la position est loin de la ligne (y compris son
  clamp vers l'avant).
- Seuil anti-téléportation à 2000 km/h.
- Filtre anti-pic de vitesse (±2 km/h par tick au-delà de 5 km/h d'écart).
- Seuil d'arrivée au terminus à 0,2 km.
- Sélection des coordonnées de voie (`lat_V1`/`lat_V2`) aux bifurcations.

### Tests
Suite **Vitest** (`npm test`) — 57 tests, 4 fichiers, uniquement des
positions GPS simulées (fixture de route synthétique type LGV Sud-Est) :

- `tests/computeSegmentIndexAndDistance.test.js` : cas nominal, tolérance
  latérale (voie parallèle), réaccrochage après tunnel, régression du snap
  (fausse arrivée), vraie arrivée au terminus, rebond de précision +
  fallback par latitude (SUD et NORD), non-recul du fallback, bifurcation,
  correction `cos(lat)` sur segment est-ouest, reprojection du garde-fou,
  seed du premier fix, cohérence des distances.
- `tests/computeCurrentDelay.test.js` : à l'heure / retard / avance, arrivée
  en avance au terminus, index hors bornes, entrées invalides (`null`, `NaN`),
  clamp de distance, easing d'entrée en gare (décélération) et de départ
  (accélération).
- `tests/tracking.test.js` : filtre de précision (limites exactes, mode
  dégradé), anti-téléportation (déplacement TGV normal, saut impossible,
  longue perte GPS en tunnel, récupération après N rejets, reset du
  compteur), vitesse médiane (pic isolé absorbé), plancher de bruit à quai,
  anti-pic historique.
- `tests/buildEffectiveRoute.test.js` : construction nominale et inversée,
  coordonnées de voie aux bifurcations (changement de voie), pénalité
  d'arrêt 90 s / 270 s, flags d'easing, répartition du ΔT global.

### Infrastructure
- `package.json` (`type: module`, script `npm test`), dépendance dev `vitest`.
- `.gitignore` (`node_modules/`).
