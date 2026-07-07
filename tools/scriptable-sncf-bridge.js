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
//   1. ouvre l'application Timeline dans une WebView plein écran ;
//   2. interroge l'API GPS du train (https://wifi.sncf/router/api/train/gps)
//      toutes les POLL_SECONDS secondes ;
//   3. injecte la position dans la page via postMessage — le listener
//      SNCF_GPS_BRIDGE de app.js prend le relais et bascule
//      automatiquement l'app en mode "WiFi SNCF (Bridge)".
//
// Prérequis : iPhone connecté au réseau WiFi "SNCF" ou "INTERCITES" à bord,
// portail accepté. App Scriptable (gratuite) installée.
//
// Installation : créer un nouveau script dans Scriptable, coller ce fichier,
// remplacer APP_URL par l'URL où l'application est hébergée.

// ⚠️ À ADAPTER : URL de l'application (HTTPS recommandé)
const APP_URL = 'https://VOTRE-DOMAINE/index.html';

const GPS_API = 'https://wifi.sncf/router/api/train/gps';
const POLL_SECONDS = 2;        // fréquence d'interrogation de l'API
const API_TIMEOUT_SECONDS = 5; // timeout par requête

const wait = (s) => new Promise((resolve) => Timer.schedule(s, false, resolve));

async function fetchTrainGps() {
    const req = new Request(GPS_API);
    req.timeoutInterval = API_TIMEOUT_SECONDS;
    const data = await req.loadJSON();
    if (!data || data.success !== true) return null;
    return data;
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

const webView = new WebView();
await webView.loadURL(APP_URL);

// present(true) = plein écran ; la promesse se résout à la fermeture.
let running = true;
const presented = webView.present(true).then(() => { running = false; });

let okCount = 0;
let failCount = 0;

while (running) {
    try {
        const gps = await fetchTrainGps();
        if (gps) {
            await webView.evaluateJavaScript(buildInjection(gps));
            okCount++;
            failCount = 0;
        } else {
            failCount++;
        }
    } catch (e) {
        failCount++;
        // API injoignable : portail pas encore accepté, ou hors réseau SNCF.
        // On continue à essayer — l'app retombe d'elle-même sur le GPS natif.
        if (failCount === 5) {
            console.warn(`API wifi.sncf injoignable (${e}). Vérifier la connexion au portail.`);
        }
    }
    await wait(POLL_SECONDS);
}

await presented;
console.log(`Bridge terminé. Positions transmises : ${okCount}`);
Script.complete();
