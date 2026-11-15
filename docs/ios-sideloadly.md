# App iOS Tallon : compilation en CI et installation via Sideloadly (Windows)

L'app iOS est une enveloppe minimale (`ios/`) autour de la PWA : même
interface, mêmes fichiers (la liste de précache de `sw.js`), plus un accès
**natif** à l'API du WiFi SNCF, sans restriction CORS. Elle se compile sur un
runner macOS de GitHub Actions et s'installe depuis Windows avec
[Sideloadly](https://sideloadly.io) et un **identifiant Apple gratuit**.

> Rien de ce document n'est validé tant que la procédure n'a pas été déroulée
> sur un iPhone réel : compilation, signature, autorisations réseau et
> renouvellement sont à confirmer lors du premier essai.

## Architecture

```
ios/
  project.yml                 Projet Xcode (XcodeGen), généré en CI
  copy-web.mjs                Copie PRECACHE_URLS de sw.js → ios/www (gitignoré)
  Tallon/
    AppDelegate.swift         Point d'entrée, scène unique
    WebViewController.swift   WKWebView plein écran, liens externes vers Safari
    BundleSchemeHandler.swift Sert ios/www sous tallon://app/ (modules ES, fetch)
    SncfBridge.swift          URLSession vers wifi.sncf uniquement (liste blanche)
    Info.plist                Autorisations, exception ATS, orientations
    Assets.xcassets           Icône (générée par tools/make-icons.py)
```

- Les pages sont **embarquées** : l'app démarre sans réseau, même derrière le
  portail captif. Une modification du web demande une nouvelle compilation.
- Le service worker n'est pas enregistré dans l'app (protocole `tallon:`), ce
  qui est voulu : les fichiers sont déjà locaux.
- `js/app.js` détecte le bridge (`window.webkit.messageHandlers.tallonNative`)
  et l'utilise à la place de `fetch`. L'analyse des réponses, la fraîcheur et le
  choix de la source sont dans `js/sncf-telemetry.js`, communs au web et à l'iOS.
- Le GPS reste celui de la page (`navigator.geolocation`), servi par iOS.

### Comportement de la source WiFi SNCF

| Situation | Effet |
|---|---|
| Réponse valide, horodatage routeur qui avance | Position ingérée, source « WiFi SNCF » |
| Même horodatage qu'au tick précédent | Ignorée (pas de doublon dans l'historique) |
| Horodatage figé depuis `SNCF_STALE_MS` (10 s) | Repli GPS, message « position figée » |
| Échec (portail, hors réseau, HTTP, TLS…) | Repli GPS, cause affichée |
| En repli, toutes les `SNCF_RETRY_MS` (15 s) | Une tentative SNCF, sans interrompre le GPS ; si elle réussit, retour automatique |

Pendant le repli, la ligne d'état du cockpit affiche « GPS (repli WiFi SNCF) ».
L'app essaie d'abord `https://wifi.sncf`, puis `http://wifi.sncf`, et garde le
premier qui répond. Réglages dans `js/train-config.js`.

## 1. Compiler l'IPA (GitHub Actions)

Le workflow `.github/workflows/ios.yml` :
1. exécute les tests web (`npm test`) : pas d'IPA si le web est cassé ;
2. copie les fichiers web dans `ios/www` ;
3. génère le projet avec XcodeGen, compile **sans signature** ;
4. publie `Tallon.ipa` comme artifact (conservé 30 jours).

Déclenchement :
- **automatique** à chaque push sur `main` ou `feat/26-ios-wrapper` touchant
  `ios/`, `js/`, `css/`, `data/`, `assets/`, les pages HTML ou `sw.js` ;
- **manuel** : GitHub → *Actions* → *iOS* → *Run workflow*. GitHub n'affiche ce
  bouton qu'une fois le workflow présent sur la branche par défaut (`main`).

Récupération :
- Interface web : ouvrir l'exécution → section *Artifacts* →
  `Tallon-ipa-<version>-<n>` (un zip qui contient `Tallon.ipa`).
- En ligne de commande :
  ```bash
  gh run list --workflow ios.yml --limit 5
  gh run download <id-de-l-execution> --dir ipa
  ```

Aucun certificat, profil ni identifiant Apple n'est utilisé ou stocké par le
workflow : la signature est faite par Sideloadly, sur votre PC.

## 2. Préparer Windows et l'iPhone (une fois)

1. Installer **iTunes** et **iCloud** depuis le site d'Apple (versions « hors
   Microsoft Store », comme le demande Sideloadly), puis **Sideloadly**.
2. Brancher l'iPhone en USB, le déverrouiller, répondre « Se fier à cet
   ordinateur ».
3. Pour le renouvellement sans câble, cocher dans iTunes « Synchroniser avec
   cet iPhone en Wi-Fi ».
4. Identifiant Apple : un compte **gratuit** suffit. Sideloadly demande ses
   identifiants (et le code de double authentification) pour obtenir un
   certificat de développement gratuit. Un identifiant Apple secondaire,
   réservé à cet usage, limite l'exposition du compte principal.

## 3. Installer

1. Extraire `Tallon.ipa` de l'artifact téléchargé.
2. Sideloadly : glisser l'IPA, choisir l'iPhone, saisir l'identifiant Apple,
   *Start*. Garder le même **Bundle ID** d'une installation à l'autre (ne pas
   activer d'option qui le modifie) : c'est ce qui conserve les réglages de
   l'app.
3. Sur l'iPhone (iOS 16 et plus) : *Réglages → Confidentialité et sécurité →
   Mode développeur* → activer, redémarrer, confirmer.
4. Si iOS signale un développeur non fiable : *Réglages → Général → VPN et
   gestion de l'appareil* → votre identifiant Apple → *Faire confiance*.
   iOS vérifie le certificat auprès d'Apple : cette étape demande un accès
   Internet, à faire avant de monter à bord.
5. Premier lancement : accepter la **localisation** (« Lorsque l'app est
   active ») — iOS peut poser la question deux fois, pour l'app puis pour la
   page — et, à bord, l'accès au **réseau local** (demandé à la première
   requête vers `wifi.sncf`).

Depuis l'éditeur de points, le retour à l'accueil se fait par un balayage
depuis le bord gauche de l'écran.

## 4. Renouveler (tous les 7 jours)

Une signature avec un identifiant Apple gratuit **expire au bout de 7 jours** :
l'app ne s'ouvre plus. Il n'existe pas d'installation permanente ni de
validité plus longue avec un compte gratuit. Autres limites du compte gratuit :
3 apps signées ainsi actives en même temps, 10 identifiants d'app par semaine.
Le renouvellement est impossible sans le PC : renouveler la veille d'un voyage.

- **Manuel** : réinstaller la même IPA (ou une plus récente) avec Sideloadly,
  même identifiant Apple, même Bundle ID. Les réglages sont conservés.
- **Automatique** : activer le rafraîchissement automatique de Sideloadly
  (service *Sideloadly Daemon*). Il ne fonctionne que si le PC est allumé,
  Sideloadly en cours d'exécution, et l'iPhone joignable (USB, ou même réseau
  Wi-Fi avec la synchronisation Wi-Fi d'iTunes activée) avant l'expiration.
  Vérifier la date d'expiration affichée par Sideloadly après chaque
  renouvellement.

## 5. Dépannage

| Symptôme | Cause probable / action |
|---|---|
| Workflow en échec à « Tests » | Régression web : corriger, `npm test` en local |
| Échec à « Génération du projet Xcode » | `ios/www` vide (étape précédente) ou `project.yml` invalide |
| Échec à « Compilation non signée » | Erreur Swift : lire le log `xcodebuild`, vérifier la version Xcode affichée. Une ligne « nearly matches » signale une méthode de délégué à aligner sur le SDK |
| Pas d'artifact | Une étape précédente a échoué ; `if-no-files-found: error` le signale |
| Sideloadly : erreur de connexion Apple | Identifiants, double authentification, ou limite des 10 identifiants d'app par semaine |
| Sideloadly : « maximum number of apps » | 3 apps gratuites déjà installées : en supprimer une |
| L'app ne s'ouvre pas, « développeur non fiable » | Étape 3.4 |
| L'app ne s'ouvre plus après une semaine | Signature expirée : renouveler (§ 4) |
| Réglages perdus après renouvellement | Bundle ID modifié : réinstaller avec le Bundle ID d'origine |
| « portail captif non accepté » | Ouvrir `http://wifi.sncf` dans Safari et accepter les CGU |
| « accès réseau local refusé » | *Réglages → Tallon → Réseau local* : activer |
| « routeur injoignable » | iPhone pas sur le WiFi du train, ou VPN / relais privé iCloud actif |
| « connexion HTTPS refusée (certificat) » | Normal sur certaines rames : l'app essaie ensuite HTTP |
| « API sans position » | Rame sans télémétrie ou sans fix : le GPS natif prend le relais |
| « position figée » | Le routeur répète la même position : repli GPS, retour automatique dès qu'elle avance |
| Pas de position GPS | *Réglages → Tallon → Position* : « Lorsque l'app est active » |

Pour inspecter la page depuis un Mac (facultatif), compiler en configuration
Debug : la WebView y est inspectable par Safari (*Développement*).
