# Localisation via le WiFi du train (wifi.sncf) sur iPhone

## L'API embarquée

Les rames équipées du WiFi à bord exposent, sur le réseau local du train, une
API de télémétrie non authentifiée :

```
GET https://wifi.sncf/router/api/train/gps
→ { "success": true, "latitude": 46.2, "longitude": 4.8,
    "speed": 76.4,        // m/s
    "timestamp": 1720000000, // s epoch
    "heading": 182.3, "fix": ... }
```

Avantages sur le GPS natif : fonctionne **dans les tunnels** (le train connaît
sa position par ses propres capteurs), position stable (pas de jitter), vitesse
directe fournie, et zéro consommation de batterie GPS. C'est la source idéale
pour cette application — quand on peut y accéder.

## Pourquoi ça ne marche pas directement dans Safari

Le toggle « Mode WiFi SNCF » de l'app fait un `fetch()` direct vers cette API
(`fetchSncfPosition` dans `app.js`). Sur iPhone/Safari cela échoue presque
toujours, pour une raison principale :

1. **CORS** : la page est servie depuis votre domaine (ex. GitHub Pages), et
   l'API `wifi.sncf` ne renvoie pas d'en-tête `Access-Control-Allow-Origin`.
   Safari bloque donc la lecture de la réponse. C'est une restriction du
   navigateur, pas du réseau : il n'existe **aucun réglage iPhone** pour la
   contourner. Ajouter l'app à l'écran d'accueil n'y change rien : une PWA
   iOS s'exécute dans le même moteur WebKit, avec la même politique d'origine
   — le mode plein écran n'accorde aucun privilège réseau supplémentaire.
2. Accessoirement : tant que le portail captif n'a pas été accepté, toute
   requête est redirigée vers la page de login (réponse invalide).

L'app gère déjà proprement cet échec : bascule automatique sur le GPS natif
avec message dans la barre de debug (`SNCF KO (...) → GPS`).

## Solutions sur iPhone, de la plus simple à la plus lourde

### Option A (recommandée) — Bridge Scriptable : `tools/scriptable-sncf-bridge.js`

L'app [Scriptable](https://scriptable.app) (gratuite) exécute du JavaScript
**natif** : ses requêtes HTTP ne sont pas soumises au CORS. Le pont était déjà
prévu côté app (listener `SNCF_GPS_BRIDGE` dans `app.js`) ; le script compagnon
est maintenant fourni dans `tools/`.

Fonctionnement :
1. Scriptable ouvre l'application dans une WebView plein écran ;
2. il interroge `wifi.sncf/router/api/train/gps` toutes les 2 s en natif ;
3. il injecte chaque position dans la page via `postMessage` ;
4. `app.js` détecte le bridge, passe en mode « WiFi SNCF (Bridge) » et affiche
   la vitesse fournie par le train.

Mise en place (une fois) :
1. Installer Scriptable depuis l'App Store.
2. Nouveau script → coller le contenu de `tools/scriptable-sncf-bridge.js`.
3. Remplacer `APP_URL` par l'URL de votre déploiement.
4. À bord : se connecter au WiFi du train, accepter le portail, lancer le
   script. C'est tout — si l'API est injoignable, l'app retombe seule sur le
   GPS natif.

Astuce : ajouter le script à l'écran d'accueil (Scriptable → partager →
« Add to Home Screen ») pour un lancement en une touche.

Limites :
- **Pas de vrai plein écran.** La WebView de Scriptable est présentée dans une
  feuille modale : le bandeau supérieur (titre + « Done ») est dessiné par
  Scriptable, aucun script ne peut le retirer. La page dispose donc d'une
  hauteur réduite. C'est la contrepartie du bridge, et c'est irréductible.
- Le service worker ne fonctionne pas dans la WebView Scriptable (l'app y
  nécessite donc du réseau au premier chargement).
- L'écran doit rester allumé : Scriptable ne tourne pas en arrière-plan.

### Quand « le bridge ne marche pas »

Toutes les causes possibles produisent le même symptôme (la page reste sur le
GPS natif). Pour les séparer :

1. Lancer `tools/scriptable-sncf-diagnostic.js` — il n'ouvre aucune WebView et
   affiche un verdict : `PORTAIL CAPTIF` (accepter les CGU dans Safari sur
   `http://wifi.sncf`), `INJOIGNABLE` (pas sur le réseau du train), `API SANS
   POSITION` (rame non équipée ou sans fix — rien à corriger côté app), ou
   `OK` avec la position. Tant que ce script n'affiche pas `OK`, le bridge ne
   peut rien injecter.
2. Si le diagnostic passe, relancer le bridge : il affiche désormais un
   bandeau d'état en bas de la page (vert `OK ×n` avec la position, rouge avec
   la cause de l'échec), la console Scriptable étant invisible sous la WebView.
   Un échec au démarrage déclenche une alerte avant même l'ouverture de l'app.

### Option B — GPS natif en PWA (zéro dépendance)

Ajouter l'app à l'écran d'accueil depuis Safari (Partager → « Sur l'écran
d'accueil »). Avec le service worker désormais en place, l'app se charge même
sans réseau. Le GPS d'un iPhone 15 Pro Max fonctionne correctement en TGV côté
fenêtre ; les coupures de tunnel sont gérées par les protections ajoutées
(filtre de précision, mode dégradé, anti-téléportation avec récupération).
C'est l'option la plus robuste au quotidien — le WiFi SNCF devient un bonus.

### Option C — Proxy CORS auto-hébergé (déconseillé à bord)

Un proxy (Cloudflare Worker, etc.) qui relaie `wifi.sncf` en ajoutant les
en-têtes CORS ne fonctionne **pas** ici : l'API n'est joignable que depuis le
réseau local du train ; un proxy sur Internet ne peut pas l'atteindre. Il
faudrait un proxy *sur le téléphone lui-même* — c'est exactement ce que fait
l'option A, sans serveur.

## Résumé

| Option | Position en tunnel | Batterie | Mise en place |
|---|---|---|---|
| A. Bridge Scriptable | ✅ oui | ✅ faible | 5 min, une fois |
| B. PWA + GPS natif | ❌ interpolée | ⚠️ GPS actif | 30 s |
| C. Proxy distant | — | — | impossible (réseau local) |

En pratique : installer les deux. Lancer le bridge quand le WiFi du train est
correct, ouvrir la PWA sinon.
