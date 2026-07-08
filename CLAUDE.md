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
- État actuel du projet : les constantes de tolérance de tracking (`MIN_ROUTE_TOLERANCE_KM`, `POINT_MATCH_TOLERANCE_KM`, `CURVE_ALLOWANCE_RATIO` dans `js/functions.js`), la pénalité d'arrêt (`STOP_PENALTY`), le seuil anti-téléportation (`TELEPORT_THRESHOLD_KMH` dans `js/app.js`) sont encore en dur au fil du code. Ne pas les dupliquer ailleurs ; à l'occasion d'un futur refactor, les regrouper dans un module de config dédié plutôt que d'en ajouter de nouvelles en dur.

## Secrets et sécurité
- Une clé/secret ne vit jamais en dur dans le code, les commits ou les logs, même partiellement.
- Utiliser exclusivement un gestionnaire de secrets (variables d'environnement locales gitignorées, secrets CI, secrets de la plateforme d'hébergement).
- Jamais de valeur par défaut ni de repli silencieux si un secret est absent : échec explicite, jamais un crash non expliqué.
- Le projet n'a aujourd'hui aucun secret/clé (app statique, `wifi.sncf` est un endpoint local non authentifié accessible uniquement à bord). Si une clé d'API externe est introduite un jour, appliquer strictement la règle ci-dessus.

## Git
- Ne jamais committer sans demande explicite de l'utilisateur.
- Ne jamais pousser (`git push`) ni agir sur le dépôt distant (tags, releases, suppression de branches distantes) sans demande explicite, même quand une tâche décrit tout un enchaînement d'actions git — s'arrêter juste avant le push et livrer un état local prêt à valider.
- Fichiers générés, environnements virtuels, caches, exports, données lourdes (`data/raw/`), `node_modules/` : toujours gitignorés, jamais versionnés.
- Travail en branche vs main : main pour un changement ponctuel à risque quasi nul et immédiatement déployable ; une branche dédiée pour un chantier structurant multi-commits.
- **Branche `dev/road-rail-route`** : chantier de test actif (mode voiture multi-mode, robustesse position, mode hors-ligne PWA, pipeline de données réelles). Ne **jamais** merger son contenu dans `main` ni le faire apparaître dans le versionnage semver de `main` tant qu'il n'a pas été explicitement validé — elle a son propre suivi (son propre `CHANGELOG.md`, encore au format `[Non publié]`).

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
- Prévoir un outil d'export du projet (profil "IA" léger : code + doc + manifeste, sans les gros fichiers de données ; profil "sauvegarde" complet en zip avec rotation des N plus récents).
- Permettre un export ciblé par périmètre (--only module) pour réduire le volume envoyé à l'IA quand la question ne porte que sur une partie du projet.
- `python/export.py` remplit ce rôle aujourd'hui (export zip horodaté X.Y.Z des fichiers `.html/.css/.js/.json`) ; encore basique (pas de profil "IA léger" ni de --only module) — à étoffer plutôt que dupliquer si le besoin se précise.

---

## Spécifique au projet : Projet-Tallon

**Quoi** : suivi de trajet TGV en temps réel (position GPS ou WiFi SNCF) contre un horaire théorique, avec calcul de retard/avance. Application web statique, aucun backend.

**Architecture front** (voir aussi `CONVENTIONS.md`) :
- `js/state.js` : état global unique (`STATE`), persistance `localStorage` des réglages utilisateur.
- `js/geo.js` : primitives géométriques pures (Haversine, projection sur segment). Aucune dépendance au DOM ni à `STATE`.
- `js/functions.js` : moteur de calcul pur — construction de route effective (`buildEffectiveRoute`), matching position→segment (`computeSegmentIndexAndDistance`), calcul de retard (`computeCurrentDelay`). Zéro DOM, testable isolément.
- `js/ui.js` : tout le rendu DOM (timeline, widget de suivi, HUD paysage avec compteur/graphe/carousel).
- `js/app.js` : orchestration — écouteurs DOM, boucle de tracking (`setInterval` 1 s), bascule GPS natif / WiFi SNCF / bridge Scriptable iOS.
- `js/routes-config.js` : `MAIN_ROUTES`, source unique des trajets proposés dans le sélecteur — consommée à la fois par `ui.js` (app) et `master-editor.js` (éditeur), donc toute route ajoutée ici apparaît automatiquement aux deux endroits.
- `js/fakeGeoSim.js` : simulateur GPS pour le développement (désactivé par défaut, `ENABLE_FAKE_GPS = false`). Ne jamais l'activer dans un commit poussé.
- `js/master-editor.js` + `master-editor.html` : éditeur visuel de `data/masterRoutes.normalized.json` (ajout/réordonnancement de points, export JSON). Les modifications n'écrivent jamais le fichier directement — export manuel puis remplacement.

**Données** :
- `data/masterRoutes.normalized.json` (schéma v3) : dictionnaire global de points (`points`) + tableau de trajets (`trajets`), chaque trajet référence des points par id avec durée jusqu'au suivant et une `voie` (1 = Paris→Province, 2 = Province→Paris) qui détermine les coordonnées à utiliser aux bifurcations.
- `data/servicePatterns.json` : patterns de desserte nommés (quels arrêts intermédiaires pour quel trajet) — distincts des trajets sélectionnables par l'utilisateur dans l'UI (`MAIN_ROUTES`), qui construisent leur propre pattern à la volée (`buildPatternFromSelection` dans `app.js`).
- `python/migrate_v2_to_v3.py` : migration ponctuelle du schéma (déjà appliquée, gardé pour référence/rollback).
- `python/extract_pk.py` : extraction de points kilométriques SNCF depuis un CSV brut (dépendances `pandas`/`tqdm`, script interactif — pas encore réécrit en stdlib pur sur `main`, cette réécriture existe sur `dev/road-rail-route`).
- `python/export.py` : export zip du projet pour partage/sauvegarde, versionné X.Y (constantes en tête de fichier, à mettre à jour manuellement).

**Pas de suite de tests ni de build sur `main` actuellement** (`package.json`/`vitest` arrivent avec `dev/road-rail-route`, pas encore mergés). Vérification manuelle via `js/fakeGeoSim.js` ou test réel en conditions.
