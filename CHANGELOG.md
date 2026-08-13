# Changelog

## v3.0.3 - 2026-08-14

### Recalage des points de passage voiture

- Intégration permanente des positions corrigées des exports cartographiques
  A40/A406, avec des PK distincts pour les chaussées aller et retour.
- Suppression du point Replonges, absent du trajet réel.
- Suppression de la sortie 18 Scionzier, absente du trajet réel.
- Remplacement de la sortie 4 par l'Aire du Musée de la Bresse, positionnée
  au PK corrigé `12.683879` fourni par l'export.
- Ajout de l'échangeur A40/A410 avec les coordonnées propres à chaque sens.
- Ajout du type et de l'icône d'aire dans le widget, le HUD et la carte.
- Affichage de la longueur des viaducs et tunnels dans la liste et les bulles
  de l'éditeur, ainsi que dans la projection du trajet du HUD.
- Les corrections de l'éditeur passent au format v2 et distinguent désormais
  les deux sens de circulation ; un export v1 est affecté au sens sélectionné.
- Remplacement de l'ETA voiture par la distance restante, seule valeur stable
  et utile pendant le trajet.
- Retrait du kilométrage officiel sous les points du carousel, incohérent entre
  les sections autoroutières et redondant avec la distance restante.

## v3.0.2 - 2026-08-14

### Correctif de chargement de la carte

- Correction de la signature d'intégrité du CSS Leaflet : Safari refusait
  la feuille de style et affichait les tuiles sans positionnement.
- Incrémentation du cache PWA pour forcer le rechargement de la page corrigée.

## v3.0.1 - 2026-08-14

### Mode voiture : GPS réactif, tunnels et éditeur cartographique

- Le suivi voiture utilise le flux GPS continu et la vitesse native du
  navigateur (m/s convertis en km/h), avec un petit historique de secours et
  un profil anti-pic beaucoup plus rapide que celui du train.
- Après 2,5 secondes sans position, le compteur affiche un tunnel et le graphe
  prolonge la dernière vitesse connue en pointillés jusqu'au retour du signal.
- `car-points-editor.html` affiche le tracé et tous les repères sur une carte
  OpenStreetMap. Les marqueurs se déplacent par glisser et sont recalés sur le
  corridor ; les corrections sont appliquées localement ou exportées en JSON.

## v3.0.0 (dev) - 2026-07-17

Branche : `dev/road-rail-route` (non mergée sur `main`). Travail en cours à
consolider dans l'entrée `v3.0.0` au moment du merge/validation — pas de bump
semver `main` tant que la branche n'est pas validée.

### HUD paysage du mode voiture, itinéraires aller/retour, secteurs & péages

Le mode voiture (`car.html`) gagne le tableau de bord paysage jusque-là
réservé au rail, adapté à la route (pas d'horaire, pas de retard), et devient
bidirectionnel. `CACHE_VERSION` bumpée (`tallon-v6`).

#### Ajouts

##### HUD paysage voiture (`js/car-ui.js`, `car.html`, `css/styles.css`)
**Cas d'usage : au volant, un dashboard lisible en un coup d'œil comme le HUD TGV.**
Réutilise le squelette visuel du HUD rail (mêmes classes/ids, mêmes styles)
mais alimenté par les points de passage de l'itinéraire au lieu des gares :
compteur de vitesse circulaire **calibré 150 km/h** (au lieu de 320), graphe
de vitesse glissant, ETA (heure + durée restante + km restants), carousel
vertical animé des sorties/échangeurs/ouvrages/péages. La pilule de retard du
rail est remplacée par une **pilule « secteur »** (le mode voiture n'a pas
d'horaire). Affiché automatiquement en rotation paysage (`updateCarHUD`).

##### Icônes par type de point de passage (`js/car-ui.js`)
**Cas d'usage : distinguer d'un coup d'œil une sortie d'un péage ou d'un tunnel.**
Chaque waypoint porte une icône Font Awesome selon son type — `sortie`,
`echangeur`, `viaduc`, `tunnel`, `peage`, `etape`, `depart`, `arrivee` — dans
le widget portrait comme dans le carousel HUD (`waypointIconHtml`).

##### Barrières de péage (`js/car-config.js`)
**Cas d'usage : anticiper les arrêts au péage sur le trajet.**
Ajout des péages Mâcon–Val de Saône (A406), Viry, Nangy et Cluses (A40),
type `peage`. ⚠️ pk **interpolés entre sorties encadrantes, approximatifs** —
à recaler sur trace GPS réelle (commenté dans la config).

##### Secteurs géographiques (`js/car-config.js`, `findSector` dans `js/car-route.js`)
**Cas d'usage : situer le trajet dans une région nommée, indépendamment du sens.**
Secteurs A40 (Mâconnais, Bresse, Bugey/Titans, Bellegarde, Genevois, Arve,
Mont-Blanc) déclarés en plages `pk` du corridor — donc **partagés aller/retour**
sans duplication. `sector` (leg entier) sert de repli. Bornes indicatives à
affiner à l'usage.

##### Itinéraire retour Combloux → Mâcon (`js/car-config.js`, `js/car-route.js`)
**Cas d'usage : suivre le trajet dans les deux sens depuis le même sélecteur.**
Nouveau `reverse: true` par leg : un corridor tracé dans le sens aller est
parcouru à rebours (géométrie de la chaussée aller, écart ~20 m avec la
chaussée opposée sous la tolérance GPS). Les waypoints, pk et secteurs sont
**partagés** entre les deux sens (aucune donnée dupliquée). Ajout de
waypoints synthétiques de départ/arrivée (`origin`/`destination`).

#### Corrections

##### Icône « signal perdu » du HUD invisible (`js/ui.js`, `js/car-ui.js`)
Le compteur affichait `fa-solid fa-signal-slash` (Font Awesome 6) alors que le
projet charge Font Awesome **5** (`fas`) : l'icône ne s'affichait jamais quand
la vitesse était jugée non fiable. Corrigé côté rail **et** voiture.

#### Outillage

##### fakeGeoSim : point de départ configurable (`js/fakeGeoSim.js`)
**Cas d'usage : tester la fin d'un long trajet sans rejouer tout le début.**
`START_OFFSET_KM` démarre la simulation à un kilométrage arbitraire le long de
la route (temps simulé équivalent calculé par distance cumulée Haversine +
interpolation dans `durationEffective`). `0` = comportement inchangé.
Rappel : `ENABLE_FAKE_GPS`/`START_OFFSET_KM` toujours remis à `false`/`0`
avant un commit poussé.

##### Tests (`tests/carRoute.test.js`)
Couverture ajoutée : legs `reverse` (points à rebours, pk décroissants, cumKm
croissant, waypoints réordonnés, interaction avec `pkRange`), waypoints
synthétiques `origin`/`destination`, et `findSector` (plages pk, repli, leg
inconnu). Suite complète : 134 tests verts.

## v3.0.0 - 2026-07-08

### Données réelles branchées : PK SNCF, corridors A406/A40/D1212, catalogue data/raw

Branche : `claude/tgv-tracker-multi-mode-83nbkd`.

Les fichiers sources attendus sont arrivés (~175 Mo dans `data/raw/`, non
versionnés) : le CSV PK SNCF, 3 GeoJSON ferroviaires d'enrichissement et les
2 CSV IGN BD TOPO de points de repère routiers. Cette section branche les
corridors réels **sans toucher au moteur JS** (les descripteurs
`data/datasets/*.json` absorbent la forme des fichiers, comme prévu) et met
en place le mécanisme de documentation/extraction demandé.

> **Release/tag** : le diff de cette section = pipeline de données réelles.
> `CACHE_VERSION` bumpée (`tallon-v3`) — penser au re-bump à chaque évolution
> des fichiers précachés.

#### Ajouts

##### Catalogue des données brutes (`data/raw/README.md`, `.gitignore`, `CLAUDE.md`)
**Cas d'usage : documenter 175 Mo de sources sans jamais les re-parser (discipline token).**
`data/raw/*` est exclu de git (seul le README y est suivi) et ne sera JAMAIS
précaché par le service worker. Le README catalogue chaque fichier : source,
volumétrie, schéma exact, pièges (NULL littéraux SNCF, `abscisse` IGN qui
redémarre par section, chaussées G/D dupliquées avec sections disjointes,
PR non monotones sur A40), usages actuels ✅ et pistes futures 🔮 (v_max au PK,
tunnels/perte GPS, enrichissement gares via `lignePK`, PR réel routier).
`CLAUDE.md` (nouveau) impose la règle aux futures sessions : lire le
catalogue, sonder en streaming, ne jamais lire ces fichiers en entier.

##### Pipeline d'extraction locale (`python/extract_pk.py` réécrit, `python/extract_pr.py`, `python/profile_raw.py`)
**Cas d'usage : produire des fichiers légers versionnés depuis les sources lourdes, re-runnable.**
Scripts stdlib uniquement (plus de pandas/tqdm/input()), non interactifs,
streaming :
- `extract_pk.py` → `data/csv/rail_pk.csv` (1,1 Mo) : lignes 752000/752100/
  830000, **toutes colonnes conservées** (vitesse, altitudes… prêtes pour de
  futures features sans ré-extraction), lignes NULL écartées, tri
  (code_ligne, pk). `--lines` pour ajouter des lignes SNCF.
- `extract_pr.py` → `data/csv/road_pr.csv` (47 Ko) : corridors `a406` (10 pts,
  8,8 km), `a40` (206 pts, 200,6 km), `d1212` (20 pts, 16,4 km). Les PR IGN
  sont dédupliqués par chaussée (clé `(numero, gestionnaire)` — les sections
  G/D sont disjointes), ré-ordonnés par **chaînage plus-proche-voisin** (la
  numérotation PR de l'A40 n'est pas monotone : APRR 102→207 puis ATMB 102→0)
  et coupés au premier saut aberrant (points hors parcours, ex. tronçon
  A40↔A6). Colonne `pk_cum` émise = km cumulés servant d'axe au corridor ;
  le PR réel reste en colonne `numero`.
- `profile_raw.py` : régénère les schémas du catalogue en markdown, à coût nul.

##### PK ferroviaire réel sur index.html (`data/csv/rail_pk.csv`, `data/datasets/rail-pk.json`)
**Cas d'usage : PK précis affiché en TGV — la feature préparée à la section précédente devient effective.**
Le descripteur passe au délimiteur virgule (seul écart avec les colonnes
devinées, qui étaient justes) ; le corridor 752000 (7113 points, LGV Sud-Est)
se charge au démarrage et la ligne d'info affiche « PK 169+900 (ligne
752000) ». Zéro changement de code applicatif.

##### Vrai itinéraire voiture A406 → A40 → D1212 (`js/car-config.js`, `js/car-route.js`, descripteurs)
**Cas d'usage : suivi Mâcon → Combloux sur les corridors IGN réels.**
Le CSV placeholder `a40_pr.csv` est supprimé, remplacé par `road_pr.csv` et
trois descripteurs (`a406-pr`, `a40-pr` réécrit, `d1212-pr`). Nouvelle option
de leg `pkRange: [min, max]` dans `buildCarRoute` : on rejoint l'A40 à la
jonction A406 (pk_cum ≈ 6,0) et on la quitte à la sortie Sallanches
(≈ 194,7) ; la D1212 est coupée à Combloux (≈ 5,3) avant Megève. Trajet total
≈ 204 km. Le « PK » affiché en voiture = km cumulés du corridor (le PR réel,
non monotone, est conservé pour un affichage futur — noté au catalogue).

#### Modifications
- `sw.js` : precache `rail_pk.csv` + `road_pr.csv` + les 2 nouveaux
  descripteurs, retrait du placeholder ; `CACHE_VERSION` → `tallon-v3`.
- `.gitignore` : `data/raw/*` (avec exception README).

#### Tests
**123 tests, 8 fichiers** (les 119 précédents inchangés + 4 tests `pkRange` :
portion [min,max], borne null non contraignante, absence d'option = corridor
complet, plage vide → erreur).
Vérification E2E (Chromium headless, GPS mocké sur les coordonnées réelles des
corridors) : index.html affiche « PK 169+900 (ligne 752000) » pendant le
tracking ; car.html enchaîne A406 → A40 → D1212 → arrivée Combloux (204,4 km,
barre à 100 %) sans erreur console.

### Référencement PK et mode voiture (Mâcon → Combloux)

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

#### Ajouts

##### Datasets CSV configurables par descripteurs JSON (`js/csv.js`, `data/datasets/*.json`)
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

##### Référencement linéaire PK (`js/linearref.js`)
**Cas d'usage : position exprimée en point kilométrique précis sur une ligne numérotée.**
Un CSV de PK est une polyline dense : le matching réutilise le moteur
existant `computeSegmentIndexAndDistance` **tel quel** (fenêtre glissante,
tolérance selon précision GPS, snap) — aucun nouveau moteur de projection.
`buildCorridor()` (filtrage, doublons, distances cumulées),
`locateOnCorridor()` (segment matché + PK interpolé PAR SEGMENT : un saut de
PK entre deux lignes ne contamine pas les voisins), `formatPk()`
(`123.456` → `"123+456"`). Le fallback par latitude est désactivé sur les
corridors (voir « Décisions » ci-dessous).

##### Moteur de position réutilisable (`js/position-engine.js`)
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

##### Mode voiture (`car.html`, `js/car-app.js`, `js/car-ui.js`, `js/car-config.js`, `js/car-route.js`)
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

##### Enrichissement PK du mode rail (`js/app.js`, `js/state.js`)
**Cas d'usage : afficher un PK précis en TGV, sans rien changer au suivi actuel.**
Au démarrage, `data/datasets/rail-pk.json` est chargé en non-bloquant : si le
CSV est présent, le PK interpolé (+ n° de ligne) s'ajoute à la ligne d'info
après chaque match réussi. **Purement informatif** : aucun couplage avec le
calcul de retard ni le matching des points nommés (endiguement du risque
volontaire). CSV absent = no-op silencieux, comportement strictement
identique à avant.

#### Modifications

- `js/functions.js` : `export` ajouté à `buildSegmentCandidate` (réutilisé par
  `linearref.js`) ; nouveau paramètre optionnel `opts.disableLatitudeFallback`
  sur `computeSegmentIndexAndDistance` (défaut : comportement inchangé).
- `sw.js` : `CACHE_VERSION` → `tallon-v2` ; pré-cache de `car.html`, des 7
  nouveaux modules JS, des descripteurs et du CSV placeholder (hors-ligne sur
  l'A40 aussi). **À l'arrivée des CSV réels, les ajouter à `PRECACHE_URLS` et
  re-bumper `CACHE_VERSION`.**
- `js/state.js` : champs `railCorridor` / `railCorridorIndex` (reset à chaque
  rechargement de route).

#### Décisions d'architecture

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

#### Tests

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

#### Brancher les CSV réels (mode d'emploi, zéro code)

1. Déposer le fichier : `data/csv/rail_pk.csv` (rail) ou remplacer
   `data/csv/a40_pr.csv` (A40).
2. Ajuster le descripteur correspondant dans `data/datasets/` : `csv`
   (délimiteur, en-tête, séparateur décimal), `columns` (noms réels des
   colonnes), `pkFormat`, `filters` (ex: ne garder qu'un `code_ligne`).
3. Ajouter le CSV à `PRECACHE_URLS` (`sw.js`) et incrémenter `CACHE_VERSION`.
4. Recharger : le PK apparaît côté rail ; le corridor A40 réel remplace le
   placeholder côté voiture. En cas d'erreur de mapping, le message
   `DatasetError` liste les colonnes réellement présentes dans le fichier.

### Mode hors-ligne (PWA) et localisation WiFi SNCF sur iPhone

#### Ajouts

##### Service worker hors-ligne (`sw.js`, `manifest.webmanifest`, `index.html`)
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

##### Bridge WiFi SNCF pour iPhone (`tools/scriptable-sncf-bridge.js`, `docs/wifi-sncf-iphone.md`)
Le listener `SNCF_GPS_BRIDGE` existait dans `app.js` mais sans script
compagnon. Ajout du script Scriptable qui ouvre l'app en WebView, interroge
nativement `https://wifi.sncf/router/api/train/gps` (hors CORS, impossible
depuis Safari) toutes les 2 s et injecte les positions via `postMessage`
(vitesse convertie m/s → km/h comme attendu par `showPosition`). Documentation
complète des options iPhone dans `docs/wifi-sncf-iphone.md`.

### Robustesse du calcul de position (cas limites TGV)

Branche : `claude/tgv-position-edge-cases-lkgh0z` (issue de `Routes-v2`).

Objectif : rendre `computeSegmentIndexAndDistance`, `computeCurrentDelay` et
`showPosition` robustes face aux cas limites réels d'un trajet TGV, sans
casser le comportement existant (garde-fou unidirectionnel, fallback par
latitude, filtre anti-téléportation conservés).

#### Corrections

##### 1. Fausse détection d'arrivée après un snap sur point (`functions.js`)
**Cas limite : sortie de tunnel / rebond de précision.**
Quand la position était trop loin de la ligne mais proche d'un point de
passage (< 900 m), le "snap sur le point le plus proche" retournait
`distanceToNextPointKm: 0`. Si le segment concerné était l'avant-dernier,
`showPosition` (seuil `< 0.2 km`) marquait le **terminus comme franchi** alors
que le train pouvait en être à plusieurs kilomètres. Le snap projette
désormais réellement la position sur le segment retenu et retourne les
distances exactes.

##### 2. Garde-fou unidirectionnel : distances incohérentes (`app.js`, `functions.js`)
**Cas limite : rebond GPS vers l'arrière.**
Quand l'index de segment était clampé pour ne pas reculer,
`distanceFromSegmentStart` restait celle mesurée sur le segment *rejeté* :
le calcul de retard mélangeait un index et une distance de deux segments
différents. Nouveau helper `projectPositionOnRouteSegment()` : les deux
distances sont reprojetées sur le segment forcé.

##### 3. Projection biaisée en longitude (`functions.js`)
`projectOnSegment` traitait les degrés de latitude et de longitude comme
équivalents. À ~46-48°N, 1° de longitude ≈ 0,68° de latitude en km : la
projection était biaisée sur les segments orientés est-ouest (jusqu'à ~30 %
d'erreur de ratio). Correction par facteur `cos(lat)` sur les composantes
longitude. Le seed du premier fix GPS (dans `showPosition`) utilisait la même
projection non corrigée ; il passe par le nouveau helper
`findNearestSegmentIndex()` qui applique la correction.

##### 4. Anti-téléportation : récupération après blocage (`tracking.js`, `app.js`)
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

##### 5. Filtre de précision des fixes (`tracking.js`, `app.js`)
**Cas limite : rebond de précision post-tunnel (positionnement cellulaire).**
Aucun filtrage n'existait sur `coords.accuracy` : un fix à ±2500 m entrait
dans le pipeline (vitesse, segment, retard). Désormais (`shouldAcceptAccuracy`),
les fixes > 800 m de précision sont rejetés, **sauf** si aucun fix n'a été
accepté depuis 30 s (mode dégradé : dans un tunnel long, mieux vaut une
position approximative que rien). Les fixes sans précision renseignée
(WiFi SNCF, bridge Scriptable) restent acceptés.

##### 6. Vitesse fantôme à l'arrêt en gare (`tracking.js`, `app.js`)
**Cas limite : entrée en gare à faible vitesse / arrêt à quai.**
Le jitter GPS d'un train à l'arrêt (±30 m) produisait une vitesse médiane
fantôme de ~10 km/h affichée au HUD. Nouveau plancher de bruit
(`noiseFloorKmh`) : si la vitesse médiane est inférieure à la vitesse que le
seul bruit de précision peut produire sur la fenêtre d'observation, elle est
ramenée à 0.

##### 7. Gel du retard à l'arrivée (`app.js`)
**Cas limite : arrivée en avance (ou à l'heure) au terminus.**
Une fois le terminus franchi, `computeCurrentDelay` continuait de croître
tant que le train restait à quai (le temps réel avance, le temps théorique
est figé). Le retard affiché est désormais gelé à la valeur constatée au
moment du franchissement du terminus — une avance reste une avance.

##### 8. Durcissement de `computeCurrentDelay` (`functions.js`)
- `segmentIndex` hors bornes (terminus affiché, route rechargée) : clampé au
  lieu de lire `route[segmentIndex]` indéfini (crash `TypeError`).
- `segmentIndex` `NaN` : retourne 0.
- `distanceFromStart` `NaN` : traitée comme 0 (aucun `NaN` propagé au HUD).

##### 9. Nettoyage
- Suppression d'un bloc mort inatteignable dans
  `computeSegmentIndexAndDistance` (second `if (!bestCandidate)`).
- Extraction de la logique pure de `showPosition` (médiane de vitesse,
  anti-pic, guards) vers `js/tracking.js` : testable hors navigateur, sans
  DOM ni GPS réel — conformément à la contrainte « tests hors conditions
  réelles ».

#### Comportements volontairement conservés
- Garde-fou unidirectionnel (l'index de segment ne recule jamais).
- Fallback par latitude quand la position est loin de la ligne (y compris son
  clamp vers l'avant).
- Seuil anti-téléportation à 2000 km/h.
- Filtre anti-pic de vitesse (±2 km/h par tick au-delà de 5 km/h d'écart).
- Seuil d'arrivée au terminus à 0,2 km.
- Sélection des coordonnées de voie (`lat_V1`/`lat_V2`) aux bifurcations.

#### Tests
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

#### Infrastructure
- `package.json` (`type: module`, script `npm test`), dépendance dev `vitest`.
- `.gitignore` (`node_modules/`).

## v2.4.1 - 2026-04-24
HUD/carousel amélioré, pont Scriptable (iOS).

## v2.4.0 - 2026-04-01
Éditeur revampé, bascule GPS/WiFi SNCF.

## v2.3.0 - 2026-03-30
Couleur du compteur de vitesse, API WiFi train, optimisations diverses.

## v2.2.0 - 2026-03-27
Landscape v2, graphique.

## v2.1.0 - 2026-01-09
Mode Landscape.

## v2.0.0 - 2025-12-25
Nouveau moteur de calcul de position, éditeur de master routes, réorganisation des données.

## v1.1.0 - 2025-06-20
Éclatement du monolithe `main.js` en modules (`app.js`/`ui.js`/`state.js`/`utils.js`), ETA.

## v1.0.0 - 2025-06-05
Refonte visuelle complète de l'interface (New GUI, formulaires, CSS optimisé iPhone).

## v0.3.0 - 2024-12-20
Refonte affichage : box & scroll, suppression PK.

## v0.2.0 - 2024-12-02
Widget de suivi + calcul du retard (delay).

## v0.1.2 - 2024-11-27
Nouveaux corridors PARLPD/LPDPAR, passage à watchPosition.

## v0.1.1 - 2024-09-20
Polish CSS/UI intensif.

## v0.1.0 - 2024-09-19
Socle fonctionnel : structure app, modèle points/routes, premier tracker multi-route.
