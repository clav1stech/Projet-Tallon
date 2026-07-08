# Projet-Tallon — Railway Timeline

Application web statique de suivi de trajet TGV en temps réel : position par
GPS ou WiFi SNCF, comparée à un horaire théorique pour afficher le retard (ou
l'avance) en direct, point de passage par point de passage.

**Version courante (`main`) : v2.4.1** — voir [CHANGELOG.md](CHANGELOG.md)
pour l'historique complet.

> Un chantier de test actif (mode voiture, mode hors-ligne, données PK
> réelles) existe sur la branche `dev/road-rail-route` mais n'est pas encore
> intégré à `main` — ce README décrit l'état actuellement sur `main`.

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

## Architecture

Application 100 % statique, sans backend ni build (modules ES natifs
`<script type="module">`, aucun bundler).

```
index.html              Page principale (sélection trajet + timeline + HUD)
master-editor.html       Éditeur visuel des trajets (data/masterRoutes.normalized.json)
css/styles.css           Tous les styles (dont HUD paysage, responsive)

js/
  state.js               État applicatif global (STATE) + persistance localStorage
  geo.js                 Géométrie pure (Haversine, projection sur segment)
  functions.js           Moteur de calcul pur : route effective, matching
                          position → segment, calcul de retard
  ui.js                  Rendu DOM (timeline, widget, HUD paysage)
  app.js                 Orchestration : écouteurs DOM, boucle de tracking,
                          bascule GPS / WiFi SNCF / bridge Scriptable
  routes-config.js        MAIN_ROUTES — source unique des trajets proposés,
                          partagée entre l'app et l'éditeur
  master-editor.js        Logique de master-editor.html
  fakeGeoSim.js           Simulateur GPS pour le développement (désactivé par défaut)

data/
  masterRoutes.normalized.json   Schéma v3 : dictionnaire de points + trajets
  servicePatterns.json           Patterns de desserte nommés

python/
  export.py               Export zip versionné du projet (partage / sauvegarde)
  extract_pk.py            Extraction de PK SNCF depuis un CSV brut (pandas)
  migrate_v2_to_v3.py      Migration ponctuelle du schéma de données (référence)
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

### Scripts Python (`python/`)

Nécessitent `pandas`/`tqdm` pour `extract_pk.py` (`pip install pandas tqdm`).
Scripts exécutés manuellement, hors production :
- `export.py` : génère un zip horodaté du projet (versionné X.Y en tête de
  fichier, à incrémenter manuellement).
- `extract_pk.py` : extrait les points kilométriques SNCF depuis un CSV brut
  (script interactif, demande le chemin du fichier).
- `migrate_v2_to_v3.py` : migration one-off déjà appliquée, gardée pour
  référence (`--dry-run` disponible).

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

Un chantier séparé (`dev/road-rail-route`, non mergé) ajoute un mode voiture,
un mode hors-ligne (PWA), une suite de tests automatisés et un pipeline de
données réelles (PK SNCF, corridors IGN) — voir le `CHANGELOG.md` propre à
cette branche pour son détail.

## Contribution

Lire [CLAUDE.md](CLAUDE.md) et [CONVENTIONS.md](CONVENTIONS.md) avant toute
contribution (ces fichiers évoluent avec le projet, ne pas s'y fier comme
figés). Pas de commit ni de push sans validation explicite.

## Licence

[MIT](LICENSE)
