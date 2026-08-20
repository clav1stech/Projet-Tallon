// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: stethoscope;
//
// ============================================================
// Diagnostic API WiFi SNCF (iPhone) — sans WebView
// ============================================================
// À bord, un échec du bridge est muet : la WebView plein écran masque la
// console Scriptable, et toutes les causes possibles (portail non accepté,
// rame sans télémétrie, endpoint en HTTP seul, DNS du portail) produisent le
// même symptôme « rien ne se passe ». Ce script isole la couche réseau :
// il n'ouvre aucune WebView et affiche un verdict lisible à l'écran.
//
// Usage : se connecter au WiFi du train, accepter le portail, lancer ce
// script. Reporter le verdict avant d'attaquer le bridge.

const ENDPOINTS = [
    'https://wifi.sncf/router/api/train/gps',
    // Certaines rames ne servent le routeur qu'en clair : tester aussi HTTP
    // évite de conclure à tort que l'API est absente.
    'http://wifi.sncf/router/api/train/gps'
];
const TIMEOUT_SECONDS = 6;

async function probe(url) {
    const req = new Request(url);
    req.timeoutInterval = TIMEOUT_SECONDS;
    req.headers = { Accept: 'application/json' };
    let body;
    try {
        body = await req.loadString();
    } catch (e) {
        return { url, verdict: 'INJOIGNABLE', detail: String(e) };
    }

    const status = req.response ? req.response.statusCode : '?';
    const mime = req.response ? (req.response.mimeType || '') : '';
    const head = (body || '').slice(0, 200).replace(/\s+/g, ' ');

    // Le portail captif répond du HTML (souvent en 200) à n'importe quelle URL
    // tant que les CGU ne sont pas acceptées : c'est la panne n°1 à bord.
    if (/^\s*</.test(body || '') || /html/i.test(mime)) {
        return { url, verdict: 'PORTAIL CAPTIF', detail: `HTTP ${status} — réponse HTML. Ouvrir Safari, charger http://wifi.sncf et accepter le portail.`, head };
    }

    let data;
    try {
        data = JSON.parse(body);
    } catch (e) {
        return { url, verdict: 'RÉPONSE NON JSON', detail: `HTTP ${status}, mime ${mime || 'inconnu'}`, head };
    }

    if (data && data.success === true) {
        const kmh = Number.isFinite(Number(data.speed)) ? (Number(data.speed) * 3.6).toFixed(1) : '?';
        return {
            url,
            verdict: 'OK',
            detail: `lat ${data.latitude}, lon ${data.longitude}, ${kmh} km/h`,
            gps: data
        };
    }

    // API présente mais sans fix : rame non équipée, capteurs KO, ou début de
    // trajet. Rien à corriger côté app — le GPS natif reste la seule source.
    return { url, verdict: 'API SANS POSITION', detail: `HTTP ${status}, success=${data && data.success}`, head };
}

const lines = [];
let success = null;

for (const url of ENDPOINTS) {
    const r = await probe(url);
    lines.push(`${url.startsWith('https') ? 'HTTPS' : 'HTTP '} → ${r.verdict}\n   ${r.detail}`);
    if (r.head) lines.push(`   Extrait : ${r.head}`);
    console.log(JSON.stringify(r, null, 2));
    if (r.verdict === 'OK') { success = r; break; }
}

const report = lines.join('\n\n');
console.log(report);

const alert = new Alert();
alert.title = success ? '✅ API WiFi SNCF joignable' : '❌ API WiFi SNCF indisponible';
alert.message = success
    ? `${success.detail}\n\nLe bridge peut fonctionner : utiliser scriptable-sncf-bridge.js.`
    : `${report}\n\nTant que ce script n'affiche pas OK, le bridge ne pourra rien injecter — c'est le réseau ou la rame, pas l'app.`;
alert.addAction('Copier le rapport');
alert.addCancelAction('Fermer');
const choice = await alert.present();
if (choice === 0) Pasteboard.copy(report);

Script.complete();
