// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: train;
//
// ============================================================
// Bridge WiFi SNCF → Railway Timeline (iPhone)
// ============================================================
// Pourquoi ce script : Safari bloque l'appel direct à l'API du portail
// wifi.sncf depuis la page web (CORS). Scriptable, lui, fait des requêtes
// natives sans restriction CORS. Ce script :
//   1. vérifie que l'API du train répond AVANT d'ouvrir quoi que ce soit ;
//   2. ouvre l'application Timeline dans une WebView plein écran ;
//   3. interroge l'API GPS du train toutes les POLL_SECONDS secondes ;
//   4. injecte la position dans la page via postMessage — le listener
//      SNCF_GPS_BRIDGE de app.js prend le relais et bascule
//      automatiquement l'app en mode "WiFi SNCF (Bridge)".
//
// La WebView affiche en permanence un bandeau d'état injecté par ce script :
// la console Scriptable étant invisible tant que la WebView est présentée,
// c'est le seul canal de diagnostic pendant le trajet. En cas de doute sur
// la couche réseau, lancer d'abord `scriptable-sncf-diagnostic.js`.
//
// Prérequis : iPhone connecté au réseau WiFi "SNCF" ou "INTERCITES" à bord,
// portail accepté. App Scriptable (gratuite) installée.
//
// Installation : créer un nouveau script dans Scriptable, coller ce fichier,
// remplacer APP_URL par l'URL où l'application est hébergée.

// ⚠️ À ADAPTER : URL de l'application (HTTPS recommandé)
const APP_URL = 'https://VOTRE-DOMAINE/index.html';

// Certaines rames ne servent le routeur qu'en clair : l'ordre de cette liste
// est celui des essais, le premier endpoint qui répond est mémorisé.
const GPS_APIS = [
    'https://wifi.sncf/router/api/train/gps',
    'http://wifi.sncf/router/api/train/gps'
];
const POLL_SECONDS = 2;        // fréquence d'interrogation de l'API
const API_TIMEOUT_SECONDS = 5; // timeout par requête

let gpsApi = null; // endpoint retenu après le premier succès

const wait = (s) => new Promise((resolve) => Timer.schedule(s, false, resolve));

async function fetchFrom(url) {
    const req = new Request(url);
    req.timeoutInterval = API_TIMEOUT_SECONDS;
    req.headers = { Accept: 'application/json' };
    const body = await req.loadString();
    // Le portail captif renvoie sa page HTML à n'importe quelle URL tant que
    // les CGU ne sont pas acceptées : le signaler explicitement plutôt que de
    // laisser échouer un JSON.parse illisible.
    if (/^\s*</.test(body || '')) throw new Error('portail captif non accepté');
    const data = JSON.parse(body);
    if (!data || data.success !== true) throw new Error('API sans position (success=false)');
    return data;
}

async function fetchTrainGps() {
    const candidates = gpsApi ? [gpsApi] : GPS_APIS;
    let lastError = null;
    for (const url of candidates) {
        try {
            const data = await fetchFrom(url);
            gpsApi = url;
            return data;
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error('aucun endpoint joignable');
}

function statusInjection(text, ok) {
    const payload = JSON.stringify({ text: String(text), ok: !!ok });
    return `(() => {
        const s = ${payload};
        let el = document.getElementById('sncf-bridge-status');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sncf-bridge-status';
            el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;'
                + 'font:11px/1.4 -apple-system,sans-serif;padding:4px 8px;'
                + 'text-align:center;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.style.background = s.ok ? 'rgba(24,90,40,0.85)' : 'rgba(120,30,30,0.9)';
        el.style.color = '#fff';
        el.textContent = 'Bridge SNCF : ' + s.text;
        return true;
    })();`;
}

function buildInjection(gps) {
    // L'API renvoie speed en m/s ; app.js attend des km/h sur ce canal.
    const speedKmh = Number.isFinite(Number(gps.speed)) ? Number(gps.speed) * 3.6 : null;
    const payload = {
        type: 'SNCF_GPS_BRIDGE',
        coords: {
            latitude: gps.latitude,
            longitude: gps.longitude,
            accuracy: 15,
            speed: speedKmh
        },
        timestamp: gps.timestamp ? gps.timestamp * 1000 : Date.now()
    };
    return `window.postMessage(${JSON.stringify(payload)}, '*'); true;`;
}

// Pré-vol : sans lui, une API injoignable se traduit par une WebView muette
// impossible à diagnostiquer une fois présentée.
let preflightError = null;
try {
    await fetchTrainGps();
} catch (e) {
    preflightError = e;
    const alert = new Alert();
    alert.title = '⚠️ API WiFi SNCF injoignable';
    alert.message = `${e.message}\n\nOuvrir l'app quand même (GPS natif) ? Le bridge continuera d'essayer en arrière-plan.`;
    alert.addAction('Ouvrir quand même');
    alert.addCancelAction('Annuler');
    if ((await alert.present()) !== 0) Script.complete();
}

const webView = new WebView();
await webView.loadURL(APP_URL);

// present(true) = plein écran ; la promesse se résout à la fermeture.
// Le bandeau supérieur de la feuille Scriptable n'est pas supprimable :
// c'est une contrainte de l'app hôte, pas de la page.
let running = true;
const presented = webView.present(true).then(() => { running = false; });

await webView.evaluateJavaScript(statusInjection(
    preflightError ? `en attente (${preflightError.message})` : 'connecté, attente de position…',
    !preflightError
));

let okCount = 0;
let failCount = 0;
let lastMessage = null;

while (running) {
    let message;
    let ok = false;
    try {
        const gps = await fetchTrainGps();
        await webView.evaluateJavaScript(buildInjection(gps));
        okCount++;
        failCount = 0;
        ok = true;
        message = `OK ×${okCount} — ${Number(gps.latitude).toFixed(4)}, ${Number(gps.longitude).toFixed(4)}`;
    } catch (e) {
        failCount++;
        // API injoignable : portail pas encore accepté, hors réseau SNCF, ou
        // rame sans télémétrie. On continue à essayer — l'app retombe d'elle-
        // même sur le GPS natif.
        message = `KO ×${failCount} — ${e.message} → GPS natif`;
    }

    if (message !== lastMessage) {
        lastMessage = message;
        console.log(message);
        try {
            await webView.evaluateJavaScript(statusInjection(message, ok));
        } catch (e) {
            // WebView fermée entre-temps : la boucle s'arrêtera au tour suivant.
        }
    }
    await wait(POLL_SECONDS);
}

await presented;
console.log(`Bridge terminé. Positions transmises : ${okCount}`);
Script.complete();
