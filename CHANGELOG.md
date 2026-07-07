# Changelog

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
