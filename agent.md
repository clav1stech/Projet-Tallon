# Instructions IA - Projet-Tallon

> Règles transverses (indépendantes du langage) en premier, invariants
> spécifiques au projet en second. Ce fichier vit au fil du projet : toute
> règle durable qui émerge en discussion doit y être ajoutée.

## Mémoire et consignation des règles
- Dès qu'une règle générale, une convention, une contrainte ou une préférence récurrente de l'utilisateur émerge en discussion, l'ajouter ici dans la section adéquate — ne jamais la laisser seulement dans un commentaire de code ou dans l'échange.
- Ne consigner que les règles durables et générales, pas un détail ponctuel propre à une seule tâche. En cas de doute sur la portée, demander avant d'inscrire.
- Préférer mettre à jour une consigne existante plutôt que d'en empiler une quasi-identique. Garder ce fichier concis et sans doublon.

## Commentaires et documentation
- Les commentaires expliquent le pourquoi (pièges, invariants, points d'attention), jamais le quoi ni la genèse.
- Proscrire les commentaires de circonstance qui répondent à une discussion ou un bug découvert avec l'IA (ex: "corrigé suite à...", "ajouté car l'IA a détecté..."). Reformuler en constat intemporel sur le code lui-même.

## Configuration
- Tout réglage (seuil, variable, constante, clé de config) se déclare dans un fichier de configuration central, jamais en dur dans la logique métier.
- Les réglages du mode train hors moteur géographique (cadence d'acquisition, perte de signal, plafond d'historique, bornes ΔT, rattachement du jour de départ) vivent dans `js/train-config.js` : y ajouter tout nouveau réglage de ce périmètre.
- État actuel du projet : les constantes de tolérance de tracking (`MIN_ROUTE_TOLERANCE_KM`, `POINT_MATCH_TOLERANCE_KM`, `CURVE_ALLOWANCE_RATIO` dans `js/functions.js`), la pénalité d'arrêt (`STOP_PENALTY`), le seuil anti-téléportation (`TELEPORT_THRESHOLD_KMH` dans `js/app.js`) sont encore en dur au fil du code. Ne pas les dupliquer ailleurs ; à l'occasion d'un futur refactor, les regrouper dans un module de config dédié plutôt que d'en ajouter de nouvelles en dur.

## Secrets et sécurité
- Une clé/secret ne vit jamais en dur dans le code, les commits ou les logs, même partiellement.
- Utiliser exclusivement un gestionnaire de secrets (variables d'environnement locales gitignorées, secrets CI, secrets de la plateforme d'hébergement).
- Jamais de valeur par défaut ni de repli silencieux si un secret est absent : échec explicite, jamais un crash non expliqué.
- Le projet n'a aujourd'hui aucun secret/clé (app statique, `wifi.sncf` est un endpoint local non authentifié accessible uniquement à bord). Si une clé d'API externe est introduite un jour, appliquer strictement la règle ci-dessus.

## Git
- Ne jamais committer sans demande explicite de l'utilisateur.
- Ne jamais pousser (`git push`) ni agir sur le dépôt distant (tags, releases, suppression de branches distantes) sans demande explicite. Les commandes autonomes `CP`, `TR` et `CPTR` définies ci-dessous constituent cette demande explicite pour toutes les opérations qu'elles désignent.
- Fichiers générés, environnements virtuels, caches, exports, données lourdes (`data/raw/`), `node_modules/` : toujours gitignorés, jamais versionnés.
- Nom de branche explicite, en français et en kebab-case, préfixé par la nature du travail (`fix/`, `feat/`, `refactor/`, `docs/`) : jamais de nom généré automatiquement (ex: `claude/<adjectif>-<nom>-<hash>`), à renommer dès la création.
- Travail en branche vs main : main pour un changement ponctuel à risque quasi nul et immédiatement déployable ; une branche dédiée pour un chantier structurant multi-commits.
- Une branche de test/expérimentation (feature non stabilisée, en cours de validation) ne s'intègre au versionnage semver de `main` qu'après validation explicite de l'utilisateur — jamais par anticipation, même si le contenu semble prêt. Voir la mémoire du projet pour l'état courant des branches en cours et lesquelles sont concernées.

### Commandes Git autonomes

Lorsque le message utilisateur, après suppression des espaces, contient uniquement l'un des termes majuscules suivants, l'exécuter comme une instruction complète sans demander une confirmation textuelle supplémentaire. Les contrôles d'autorisation imposés par les outils restent applicables.

- `CP` — **Commit + Push** : inspecter le statut et le diff, vérifier que toutes les modifications appartiennent à la tâche, exécuter les tests pertinents, committer avec un message concis puis pousser la branche courante. Ne pas créer de tag, de release ni de pull request. Ne pas faire de bump semver pour un changement purement documentaire ou interne.
- `TR` — **Tag + Release** : publier le `HEAD` déjà validé et poussé. Lire la version en tête de `CHANGELOG.md` ; si une section `Non publié` doit devenir une release, lui attribuer la version semver appropriée, mettre à jour le changelog, committer et pousser uniquement cette préparation de release, puis créer et pousser le tag annoté `vX.Y.Z` et créer la release GitHub publique correspondante. Si le tag existe déjà, ne jamais le déplacer sauf si le contexte demande explicitement de corriger cette release. Ne pas créer de pull request.
- `CPTR` — **Commit + Push + Tag + Release** : effectuer la chaîne complète `CP`, puis `TR`, dans la même intervention. Pour un changement publiable sans version déjà préparée, déterminer la version selon les règles semver ci-dessous — bump `Z` par défaut — et intégrer le changelog au commit avant le push. Créer ensuite le tag annoté et la release GitHub publique. Si le contexte demande explicitement la correction de la version précédente, mettre à jour ce tag et cette release au lieu d'en créer une nouvelle. Ne pas créer de pull request.

Dans les trois cas, utiliser uniquement les fichiers liés au travail en cours, ne jamais absorber silencieusement des changements étrangers, vérifier à la fin que la branche distante et les tags pointent sur les commits attendus, puis communiquer le hash du commit et, pour `TR`/`CPTR`, l'URL de la release.

## Versionnage sémantique X.Y.Z
- Z (patch) : changement significatif normal, cas par défaut.
- Y (minor) : chantier structurant nécessitant une branche dédiée ; remet Z à 0.
- X (major) : jamais décidé par l'IA, uniquement sur demande explicite de l'utilisateur.
- Le bump de version n'a lieu que pour un commit poussé qui change un comportement visible, jamais pour un commit purement interne (doc, outillage, typo, commentaire).
- Le message de commit du bump commence par "vX.Y.Z: résumé".
- Version courante de `main` : voir `CHANGELOG.md` (en tête de fichier) — ne pas supposer, toujours vérifier avant d'annoncer un numéro de version.

## Changelog
- Chaque commit qui bump la version doit mettre à jour CHANGELOG.md dans le même commit (entrée X.Y.Z - date, résumé en tête de fichier).
- Pas de saisie manuelle séparée : un script dédié régénère/complète le fichier de façon idempotente (n'ajoute que les versions absentes, ne touche pas aux entrées existantes) — à écrire si le rythme de versionnage s'intensifie ; pour l'instant les entrées sont rédigées à la main, en respectant le même format.

## Non-régression obligatoire pour tout refactor
1. Capturer un état de référence AVANT toute modification (calculs, rendu, sorties) via un harnais dédié, en lecture seule sur les données.
2. Modifier le code.
3. Revérifier APRÈS : 100% identique attendu, mêmes données, mêmes conditions figées (heure, seed, etc.), sauf changement de comportement volontaire justifié explicitement dans le message de commit/PR.
4. Le moteur de tracking (`computeSegmentIndexAndDistance`, `computeCurrentDelay`, `buildEffectiveRoute` dans `js/functions.js`) est le cœur critique de l'app : toute modification y touchant doit être vérifiée manuellement (ou via `js/fakeGeoSim.js`, la simulation GPS de dev) avant merge, garde-fou unidirectionnel et anti-téléportation compris.

## Écriture de données
- Écriture atomique obligatoire : écrire dans un fichier temporaire puis renommer/remplacer, jamais d'écriture directe qui laisserait un état partiel sur le disque.
- Toute correction de données critiques commence par une sauvegarde datée avant modification.
- Ne jamais corriger des données de production spontanément, même une incohérence apparente : correction uniquement sur demande explicite, après un problème identifié et discuté.
- `data/masterRoutes.normalized.json` est la source de vérité géo/horaire ; sa modification manuelle est risquée (mise en cohérence points/trajets/voies) — préférer `master-editor.html` qui exporte un JSON validé, ou un script `python/` dédié.

## Architecture et dépendances
- Imports/couches à sens unique, jamais de dépendance circulaire entre modules de même niveau.
- Aucune nouvelle dépendance externe sans justification forte.
- Un fichier CODEMAP (carte du code) et un fichier CONVENTIONS (style, où mettre quoi) sont tenus à jour et lus avant toute intervention, plutôt que de parcourir tout le code. Voir `CONVENTIONS.md` pour le détail "où mettre quoi" de ce projet ; pas de CODEMAP séparé pour l'instant, la section "Architecture" de `README.md` en tient lieu.
- Sens de dépendance du front : `state.js` (données) ← `functions.js`/`geo.js` (calcul pur, ne touchent jamais au DOM) ← `ui.js` (rendu DOM) ← `app.js` (orchestration/événements). `routes-config.js` est transverse (consommé par `ui.js` ET `master-editor.js`).

## Export / partage de contexte vers l'IA
- `python/export.py` (commandes détaillées dans `docs/commands.md`) exporte sous la vraie version courante, lue en tête de `CHANGELOG.md` (jamais codée en dur dans le script).
- Export complet (défaut, sans argument) : génère simultanément un profil "IA" léger (JSON tronqué + manifeste arborescence/rôle par fichier) et un profil "complet" (JSON intégral), pour ne payer le coût en tokens du détail des données que quand c'est nécessaire.
- Export "lite" (`--lite release` / `--lite commit`) : diff texte depuis la dernière release (dernier tag `vX.Y.0`) ou depuis le dernier commit de version (dernier tag `vX.Y.Z`), pour ne transmettre que ce qui a changé.
- Reste à faire si le besoin se précise : export ciblé par périmètre (`--only module`), et/ou profil "sauvegarde" complet en zip avec rotation des N plus récents — ne pas dupliquer, étoffer `export.py` le moment venu.

---

## Spécifique au projet : Projet-Tallon

**Quoi** : suivi de trajet TGV en temps réel (position GPS ou WiFi SNCF) contre un horaire théorique, avec calcul de retard/avance (+ mode voiture : progression et distance restante sans horaire). Application 100 % statique en vanilla JS (modules ES, aucun bundler), aucun backend.

**Architecture front** (voir aussi `CONVENTIONS.md`) :
- `js/state.js` : état global unique (`STATE`), persistance `localStorage` des réglages utilisateur. Quatre familles à ne jamais confondre : navigation (`view`), configuration provisoire (`draftConfig`, le formulaire), configuration appliquée (`appliedConfig`, `tripPlan` et ses miroirs `currentRoute`/`departureTimestamp`…), session de tracking (`session` = acquisitions brutes et garde-fous, plus les résultats dérivés `passedPoints`/`passageTimes`/`trackingSnapshot`).
- `js/geo.js` : primitives géométriques pures (Haversine, projection sur segment). Aucune dépendance au DOM ni à `STATE`.
- `js/functions.js` : moteur de calcul pur — construction de route effective (`buildEffectiveRoute`), matching position→segment (`computeSegmentIndexAndDistance`), calcul de retard (`computeCurrentDelay`). Zéro DOM, testable isolément.
- `js/trip-config.js` : calcul pur de la configuration de trajet — forme canonique, écarts entre configurations, plan horaire (`buildTripPlan`, qui appelle `buildEffectiveRoute`), synthèse de desserte (`buildServiceSummary` : gares commerciales desservies uniquement, horaires datés y compris après minuit).
- `js/tracking-session.js` : session de tracking sans DOM — `acceptFix` (filtres d'acquisition, indépendants du trajet), `advanceOnRoute` (accrochage au trajet appliqué, déterministe), `replaySession` (recalcul des dérivés depuis l'historique brut) et vues de données (`buildCockpitModel`, `buildSpeedProfile`, `getPassageLog`, `getLocationStatus`).
- `js/train-controller.js` : seules transitions autorisées entre les quatre familles d'état (`setDraft`, `launchSession`, `applyDraft`, `revertDraft`, `showView`, `stopSession`). **Invariant : changer de vue ou éditer le formulaire ne touche jamais à la session ; appliquer une configuration rejoue les dérivés sans supprimer d'acquisition ni recréer la boucle de localisation.** Toute nouvelle transition passe par ce module et par ses tests (`tests/trainController.test.js`).
- `js/point-labels.js` : choix pur entre nom complet et abrégé (`POINT_NAME_ABBREVIATIONS`). Les données portent toujours la forme longue ; `ui.js` mesure la place au format « prochain point » dans le carrousel réel et applique le même libellé à tous les affichages du nom, recalculé à chaque changement de taille. Ne jamais stocker une forme abrégée dans les données.
- `js/ui.js` : rendu DOM du train (accueil à ligne éditable, cockpit et carousel dans les deux orientations, profil complet et journal des passages). `js/train-profile.js` réduit les mesures par colonne de pixels sans tronquer l’historique.
- **Socle commun aux deux modes** (train et voiture sont deux pages d'une même application) : `css/train.css` (mise en page de l'accueil, du cockpit et du carrousel, pilotée par variables ; `css/car.css` n'y ajoute que le thème bleu nuit et les éléments routiers ; les éditeurs ont leur propre socle, `css/editor.css`), `js/session-flow.js` (règles lancer / appliquer / reprendre), `js/app-mode.js` + `js/app-shell.js` (changement de mode, aides DOM, bandeau, détection iPhone), `js/carousel-view.js` (géométrie du carrousel, tête de lecture, suivi et recentrage), `js/speed-profile-view.js` (tracé et inspection du profil). Ne mutualiser que ce qui a la même sémantique : horaires, gares et retards restent dans les modules du train ; secteurs, ouvrages et extrapolation en tunnel dans ceux de la voiture.
- **Changement de mode** : un mode = une page (`index.html`, `car.html`), avec son manifeste, son état et ses clés `localStorage`. Changer de mode est une navigation sans entrée d'historique (`location.replace`, le conteneur iOS active le geste retour) ; une session active est terminée après confirmation (`initModeSwitch`), jamais reprise au retour. Seul le conteneur iOS rouvre le dernier mode (`resolveLaunchRedirect`) : sur le web, chaque icône PWA ouvre le sien.
- `js/app.js` : orchestration — écouteurs DOM, boucle de tracking (`setInterval` 1 s, créée au lancement d'une session et détruite à sa clôture, jamais ailleurs), bascule GPS natif / WiFi SNCF / bridge Scriptable iOS / bridge natif de l'app iOS. Le rendu du suivi (`renderTracking`) se fait depuis l'état, sans attendre de fix.
- `js/routes-config.js` : `MAIN_ROUTES`, source unique des trajets proposés dans le sélecteur — consommée à la fois par `ui.js` (app) et `master-editor.js` (éditeur), donc toute route ajoutée ici apparaît automatiquement aux deux endroits.
- `js/fakeGeoSim.js` : simulateur GPS pour le développement (désactivé par défaut, `ENABLE_FAKE_GPS = false`). Ne jamais l'activer dans un commit poussé.
- **Atelier d'édition** (`master-editor.html`, `route-profile.html`, `train-points-editor.html`, `car-points-editor.html`) : une même coquille (`js/editor-shell.js`, navigation, bandeau de brouillon, état) et un même socle visuel (`css/editor.css`). Les pages rail éditent un **brouillon local partagé** (`js/master-routes-draft.js`) : jamais lu par l'app, effacé dès qu'il redevient identique au fichier servi. Seul l'export JSON, recopié à la main sur le fichier, atteint l'application. Toute nouvelle page d'éditeur se déclare dans `EDITOR_PAGES` et dans le précache (`sw.js`), que le test d'intégrité vérifie.
- `js/master-editor.js` + `master-editor.html` : éditeur des trajets de `data/masterRoutes.normalized.json` (insertion, réordonnancement, durées en secondes ou `m:ss`, annulation, export JSON validé). Une suppression reporte la durée du point sur le segment précédent ; un point nommé par `MAIN_ROUTES` ne peut être ni supprimé ni renommé depuis l'éditeur.
- `js/route-speed.js` : profil de vitesse théorique pur (distance moteur et PK, vitesse moyenne, statut de plausibilité selon `ROUTE_SPEED_BOUNDS_KMH`). Seule implémentation de ce calcul : éditeur, page `route-profile.html` et test d'intégrité la partagent, pour qu'un segment jugé aberrant le soit partout.
- `js/master-routes-data.js` : chargement, validation et export du schéma v3 partagés par les éditeurs.
  `js/train-points-model.js` + `js/train-structure-endpoints.js` + `js/train-map-polyline.js` + `js/train-points-editor.js` + `train-points-editor.html` : placement cartographique rail sur OpenRailwayMap, avec positions directionnelles V1/V2 pour les bifurcations et ouvrages d'art, projection des longueurs et du tracé complet sur les polylines ferroviaires, et export manuel validé.
- `js/car-config.js`, `js/car-route.js`, `js/car-session.js`, `js/car-app.js`, `js/car-ui.js` + `car.html` : mode voiture (suivi Mâcon ⇄ Combloux) — corridors PR (A406/A40/D1212) + waypoints, progression + distance restante, secteurs géographiques ; jamais d'horaire, d'ETA ni de retard. `car-session.js` tient les mêmes frontières que `train-controller.js` (navigation, itinéraire provisoire, itinéraire appliqué, session). **Invariants : l'acquisition GPS est créée au lancement et détruite à la clôture, jamais par la navigation ni par un changement d'itinéraire (qui ne remet à zéro que la progression le long de l'ancien trajet) ; une progression estimée (tunnel, perte de signal) n'est jamais présentée ni comptée comme une mesure.**

**Données** :
- `data/masterRoutes.normalized.json` (schéma v3) : dictionnaire global de points (`points`) + tableau de trajets (`trajets`), chaque trajet référence des points par id avec durée jusqu'au suivant et une `voie` (1 = Paris→Province, 2 = Province→Paris) qui détermine les coordonnées à utiliser aux bifurcations.
- `data/servicePatterns.json` : patterns de desserte nommés (quels arrêts intermédiaires pour quel trajet) — distincts des trajets sélectionnables par l'utilisateur dans l'UI (`MAIN_ROUTES`), qui construisent leur propre pattern à la volée (`buildPatternFromSelection` dans `app.js`).
- `data/datasets/*.json` : descripteurs de CSV (délimiteur, mapping de colonnes, format PK, filtres) consommés par le parseur générique `js/csv.js` et les corridors `js/linearref.js`. Brancher/changer un fichier source = éditer le descripteur, jamais le code.
- `python/migrate_v2_to_v3.py` : migration ponctuelle du schéma (déjà appliquée, gardé pour référence/rollback).
- `python/extract_pk.py` : extraction de points kilométriques SNCF depuis un CSV brut → `data/csv/rail_pk.csv`, stdlib pur (streaming, non interactif).
- `python/extract_pr.py` : extraction des PR IGN BD TOPO pour les corridors routiers (A406/A40/D1212) → `data/csv/road_pr.csv`.
- `python/refine_corridors.py` : géométrie fine des corridors routiers depuis une trace GPS réelle (`data/raw/gps/`, non versionnée) → `data/csv/road_trace.csv` (rééchantillonnage selon vitesse, PR interpolés dans le référentiel `pk_cum` de `road_pr.csv`, repli PR IGN dans les trous GPS). C'est ce fichier que consomme le mode voiture ; `road_pr.csv` reste la référence PR.
- `python/fix_route_durations.py` : correction des durées mal réparties Paris ⇄ Mâcon / Lyon / Marseille et réinsertion de Valence TGV au retour (simulation par défaut, `--apply` pour sauvegarder puis écrire). Modèle pour toute correction de données : ancienne valeur attendue par segment, insertion de point vérifiée par ses voisins, refus si les données ont changé, sauvegarde datée dans `data/backups/` (gitignoré), écriture atomique.
- `python/calibrate_lgv_durations.py` : recalage des durées LGV Moisenay ⇄ Mâcon-Loché (`PAR_MAC_SUD`, `MAC_PAR_NORD`) sur les horaires commerciaux de référence (`REFERENCE_TOTALS_S`), Paris ⇄ Moisenay jamais modifié. Marche tendue simulée sur les PK (270 km/h jusqu'à Saint-Florentin, 300 km/h au-delà, démarrage et freinage), marge de régularité répartie au prorata du temps de marche tendue, jamais uniformément ni au prorata de la distance. Même garde-fous que `fix_route_durations.py`.
- `python/export.py` : export texte du projet pour partage de contexte IA (profils "ia"/"full" + mode "lite" par diff), versionné automatiquement sur `CHANGELOG.md` — voir `docs/commands.md`.

**Données brutes (`data/raw/`)** :
- Fichiers sources volumineux (~175 Mo), **non versionnés**, jamais précachés par le service worker : CSV PK SNCF, GeoJSON ferroviaires, CSV IGN BD TOPO. Catalogue complet (schémas exacts, volumétrie, pièges, usages présents/futurs) dans `data/raw/README.md` — seul fichier du dossier suivi par git.
- **Ne jamais lire ces fichiers intégralement** (30–109 Mo chacun) : lire d'abord le catalogue ; si besoin, `head -3`, un one-liner python en streaming, ou `python3 python/profile_raw.py` (régénère les schémas du catalogue).
- Régénération des fichiers app (légers, versionnés dans `data/csv/`) : `python3 python/extract_pk.py` (rail), `python3 python/extract_pr.py` (route).

**Mode hors-ligne (PWA)** : `sw.js` précache la coquille applicative (HTML/CSS/JS/JSONs de routes) et la sert en *stale-while-revalidate* (réponse instantanée depuis le cache, mise à jour en arrière-plan) — l'app fonctionne intégralement sans réseau après la première visite ; les appels temps réel (`wifi.sncf`) ne sont jamais mis en cache. Incrémenter `CACHE_VERSION` dans `sw.js` à chaque changement de fichier précaché. Chaque page installable possède son propre manifeste (`manifest.webmanifest` → `index.html`, `car.webmanifest` → `car.html`) : sur iOS, « Sur l'écran d'accueil » suit le `start_url` du manifeste de la page, donc un manifeste partagé ferait pointer toutes les icônes vers la même app. Avec les méta `apple-mobile-web-app-*`, l'installation se fait en PWA plein écran sur iPhone. Les icônes d'écran d'accueil sont générées par `python3 tools/make-icons.py` (pillow) dans `assets/icons/` et versionnées : iOS ne lit que `<link rel="apple-touch-icon">` (180×180), le tableau `icons` du manifeste ne sert qu'aux autres plateformes. Retoucher le script, jamais les PNG. Une PWA reste une page WebKit : elle n'affranchit d'aucune restriction CORS (voir `docs/wifi-sncf-iphone.md`).
- `js/sncf-telemetry.js` : télémétrie WiFi SNCF sans DOM ni réseau — lecture des réponses du routeur (portail captif, unités m/s → km/h, s → ms), fraîcheur mesurée sur l'avancée de l'horodatage routeur (jamais par différence d'horloges), choix de la source (repli GPS, retour périodique au WiFi SNCF). Le transport (fetch web ou bridge natif) reste dans `app.js`. Le retard constant de la position routeur (`SNCF_POSITION_LAG_MS`) est compensé dans `advanceOnRoute` par une avance le long du trajet (vitesse × retard), portée par l'échantillon (`leadKm`) pour un rejeu identique ; les coordonnées mesurées ne sont jamais modifiées.
- `ios/` : conteneur iOS (Swift + WKWebView, projet décrit par `ios/project.yml` et généré par XcodeGen en CI, jamais de `.xcodeproj` versionné). Les pages sont celles de `PRECACHE_URLS` (`sw.js`), copiées dans `ios/www` (gitignoré) par `ios/copy-web.mjs` et servies sous `tallon://app/` ; ajouter un fichier à l'app = l'ajouter au précache. `SncfBridge.swift` n'accepte que l'hôte `wifi.sncf`, ne suit pas les redirections et ne fait que transporter : toute interprétation reste en JS. Aucun certificat ni identifiant Apple dans le dépôt ou les secrets : IPA non signé, signé par Sideloadly (`docs/ios-sideloadly.md`).
- `tools/scriptable-sncf-bridge.js` (+ `tools/scriptable-sncf-diagnostic.js`, `docs/wifi-sncf-iphone.md`) : scripts Scriptable qui contournent CORS pour interroger `wifi.sncf` nativement sur iPhone ; le bridge injecte les positions via `postMessage` (écouteur `SNCF_GPS_BRIDGE` dans `app.js`) et un bandeau d'état dans la page, le diagnostic isole la couche réseau sans WebView. La feuille Scriptable impose un bandeau supérieur non supprimable : la WebView n'est jamais réellement plein écran.
- La détection iPhone (`isIPhoneDevice` dans `app-shell.js`, commune aux deux modes) ne doit jamais reposer sur le seul user-agent : une WebView hôte peut l'altérer et faire basculer la page sur la mise en page non-iPhone. Se replier sur `navigator.platform`.

**Suite de tests** : Vitest (`npm test`), modules sans DOM uniquement (calcul pur, session et contrôleur du mode train, qui reçoivent l'état en paramètre). Harnais navigateur local : servir le dépôt puis ouvrir `tests/browser/train-ui.html` ou `tests/browser/car-ui.html` (acquisition simulée et préférences isolées, contrôles responsive et cycle de session ; le harnais voiture couvre aussi tunnels, changement d'itinéraire et l'enchaînement voiture → train → voiture sur les pages réelles). Vérification manuelle complémentaire via `js/fakeGeoSim.js` (simulation GPS de dev) ou test réel en conditions.

**CI** : `.github/workflows/ci.yml` (GitHub Actions, Node 22) exécute `npm ci`, `npm run check:syntax` puis `npm test` sur chaque push et pull request vers `main`. Contrôle uniquement : la publication GitHub Pages reste hors workflow. `tests/dataIntegrity.test.js` vérifie la cohérence référentielle des données (patterns, `MAIN_ROUTES`, datasets, précache `sw.js`) ; ses `KNOWN_ANOMALIES` listent les écarts de données connus, à corriger sur demande explicite puis à retirer de la liste ; `KNOWN_SPEED_ANOMALIES` fait de même pour les segments dont la vitesse moyenne sort de `ROUTE_SPEED_BOUNDS_KMH` (durée rangée sur le mauvais segment). Toute nouvelle vérification de données se greffe sur cette suite plutôt que sur un nouveau job. `.github/workflows/ios.yml` (runner macOS, `workflow_dispatch` uniquement : Actions → iOS → Run workflow, jamais sur push/PR/tag, pour économiser le quota) rejoue ces tests puis produit l'IPA non signé de l'app iOS en artifact. Ne jamais lui rajouter de déclencheur automatique.
