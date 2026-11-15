# Conventions de code - Projet-Tallon

> Règles courtes pour toute contribution humaine ou IA. Règles transverses en
> premier, "où mettre quoi" spécifique au projet en second. Ce fichier vit au
> fil du projet.

## Langue et style
- Docstrings et commentaires : denses, orientés "pourquoi" (pièges, invariants), jamais la genèse.
- Ne pas renommer sans nécessité : les noms sont le contrat des harnais de non-régression et des intégrations.
- Respecter la limite de longueur de ligne déjà en vigueur dans le projet (adopter l'existant, ne pas l'imposer arbitrairement).
- Commentaires et logs applicatifs en français (cohérent avec l'existant : `js/*.js`, messages `console.log`/`updateInfo`), noms de variables/fonctions en anglais (`buildEffectiveRoute`, `computeCurrentDelay`, `showPosition`...).

## Où mettre quoi
- Un réglage (seuil, variable, constante) va dans la config, jamais en dur dans la logique (voir `agent.md` § Configuration pour l'état actuel des constantes encore en dur à ne pas dupliquer).
- Accès/sélection de données séparés du calcul métier (pas de logique métier dans la couche d'accès aux données).
- Une fonctionnalité générique (utilisable par plusieurs modules) va dans une couche transverse ; une fonctionnalité spécifique reste dans son module/domaine dédié.
- Mapping concret pour ce projet :
  - Géométrie pure (distances, projections) → `js/geo.js`.
  - Calcul métier pur (route effective, matching segment, retard) → `js/functions.js`. Ne doit jamais toucher au DOM ni à `window`.
  - État applicatif partagé → `js/state.js` (objet `STATE` unique, pas d'état parallèle ailleurs).
  - Configuration de trajet, horaires, synthèse de desserte → `js/trip-config.js` (pur). Acquisition, accrochage au trajet, rejeu et modèles de données du suivi → `js/tracking-session.js`. Passage d'une famille d'état à l'autre (navigation, provisoire, appliquée, session) → `js/train-controller.js` exclusivement. Aucun de ces modules ne touche au DOM ; le rendu n'y recalcule jamais un horaire.
  - Réglages du mode train → `js/train-config.js`.
  - Commun aux deux modes de transport → `js/session-flow.js` (règles de session), `js/app-mode.js` / `js/app-shell.js` (changement de mode, aides DOM), `js/carousel-view.js`, `js/speed-profile-view.js`, `css/train.css`. Session voiture sans DOM → `js/car-session.js` ; rendu voiture → `js/car-ui.js` ; thème et éléments routiers → `css/car.css`.
  - Rendu / manipulation DOM du train → `js/ui.js` exclusivement. `app.js` ne touche le DOM que pour ses propres écouteurs d'événements (formulaire, bouton start, swipe).
  - Config de trajets partagée entre l'app et l'éditeur → `js/routes-config.js` (`MAIN_ROUTES`), jamais dupliquée localement dans `ui.js` ou `master-editor.js`.
  - Utilitaires génériques sans dépendance métier (formatage, sélecteurs DOM courts) → `js/utils.js`.
  - Simulation/outillage de dev → fichier dédié explicitement toggé (`js/fakeGeoSim.js`, `ENABLE_FAKE_GPS`), jamais mélangé au code de prod.
  - Code natif iOS → `ios/Tallon/*.swift`, limité au chargement des pages et au transport réseau ; toute logique (analyse, bascule de source) reste en JS testable par Vitest.
  - Script Python one-off (migration, extraction, export) → `python/`, avec docstring d'usage en tête de fichier.

## Imports et dépendances
- Imports absolus de préférence (modules ES via `<script type="module">`, imports relatifs `./fichier.js` au sein de `js/` — pas d'imports absolus configurés côté build, il n'y a pas de build).
- Sens unique entre couches : `state.js` → `geo.js`/`functions.js` (calcul pur) → `ui.js` (rendu) → `app.js` (orchestration). `routes-config.js` est transverse, consommé par `ui.js` et `master-editor.js` sans jamais dépendre d'eux.
- Aucune nouvelle dépendance externe sans justification forte. Dépendance CDN existante : Font Awesome (icônes) — pas de gestionnaire de paquets front, ne pas en introduire un pour une seule lib.
- Les scripts `python/` peuvent utiliser des dépendances externes (`pandas`, `tqdm`) car isolés de l'app web et exécutés manuellement hors production ; toujours documenter la dépendance en tête de script.

## Données
- Toute source de données externe (fichier legacy, base tierce) : lecture seule côté application, sauf mécanisme explicite documenté de mise à jour avec sauvegarde préalable.
- Ne jamais écrire directement dans `data/masterRoutes.normalized.json` ou `data/servicePatterns.json` à la main pour une modification substantielle : passer par `master-editor.html` (export JSON) ou un script `python/` dédié et testé.
- Le schéma des données (`_schema: "v3"`) est un contrat : toute évolution de structure doit être accompagnée d'un script de migration dans `python/` (voir `migrate_v2_to_v3.py` comme modèle) plutôt que d'une modification silencieuse.

## Non-régression obligatoire pour tout refactor
1. Capturer un état de référence avant modification (harnais dédié).
2. Modifier.
3. Vérifier 100% identique après, sauf changement de comportement voulu et justifié dans le message de commit/PR.
4. Pour le moteur de tracking (`js/functions.js`), utiliser `js/fakeGeoSim.js` pour rejouer un trajet simulé avant/après modification en l'absence de suite de tests automatisée sur `main`.

## Git
- Ne jamais committer sans demande explicite de l'utilisateur.
- Ne jamais pousser ni agir sur le dépôt distant sans demande explicite (voir `agent.md` § Git).
- Environnements, caches, artefacts d'export, `data/raw/`, `node_modules/` : jamais versionnés.
