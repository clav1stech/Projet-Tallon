// js/sncf-telemetry.js
// Télémétrie WiFi SNCF, sans DOM ni réseau : lecture d'une réponse du routeur,
// fraîcheur de la position et choix de la source à interroger. Le transport
// (fetch web ou bridge natif iOS) reste dans app.js.

import { SNCF_RETRY_MS, SNCF_STALE_MS } from './train-config.js';

// Messages affichés tels quels sur l'iPhone : seul canal de diagnostic à bord.
const FAILURE_MESSAGES = {
    captive: 'portail captif non accepté (ouvrir http://wifi.sncf dans Safari)',
    'no-fix': 'API sans position (rame non équipée ou sans fix)',
    invalid: 'réponse illisible',
    http: 'erreur HTTP',
    stale: 'position figée',
    timeout: 'délai dépassé',
    offline: 'pas de réseau WiFi',
    unreachable: 'routeur injoignable (hors réseau du train ?)',
    'local-network': 'accès réseau local refusé (Réglages › Tallon › Réseau local)',
    tls: 'connexion HTTPS refusée (certificat)',
    ats: 'HTTP bloqué par iOS',
    blocked: 'requête bloquée par le navigateur (CORS) ou réseau injoignable',
    refused: 'requête refusée par le bridge natif'
};

function failure(kind, detail) {
    const base = FAILURE_MESSAGES[kind] || kind;
    return { ok: false, kind, message: detail ? `${base} · ${detail}` : base };
}

/**
 * Interprète une réponse brute du transport.
 * @param {{ok:boolean, status?:number, body?:string, location?:string, kind?:string, detail?:string}} raw
 *   `ok:false` = échec réseau qualifié par le transport (`kind`).
 * @returns {{ok:true, fix:object, routerTs:number|null} | {ok:false, kind:string, message:string}}
 *   `fix` au format navigator.geolocation, vitesse en km/h comme l'attend
 *   acceptFix pour la source 'sncf'.
 */
export function parseSncfResponse(raw) {
    if (!raw?.ok) return failure(raw?.kind || 'unreachable', raw?.detail);
    const body = typeof raw.body === 'string' ? raw.body : '';
    // Tant que les CGU ne sont pas acceptées, le portail redirige ou sert sa
    // page HTML à n'importe quelle URL.
    if (raw.status >= 300 && raw.status < 400) return failure('captive', raw.location ? `redirection vers ${raw.location}` : `HTTP ${raw.status}`);
    if (/^\s*</.test(body)) return failure('captive');
    if (raw.status && (raw.status < 200 || raw.status >= 300)) return failure('http', `HTTP ${raw.status}`);
    let data;
    try { data = JSON.parse(body); } catch { return failure('invalid'); }
    if (!data || data.success !== true) return failure('no-fix');
    // Number(null) vaut 0 : une coordonnée absente deviendrait le golfe de Guinée.
    const latitude = data.latitude == null || data.latitude === '' ? NaN : Number(data.latitude);
    const longitude = data.longitude == null || data.longitude === '' ? NaN : Number(data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return failure('no-fix');
    // L'API fournit la vitesse en m/s et l'horodatage en secondes epoch.
    const speed = data.speed != null && data.speed !== '' && Number.isFinite(Number(data.speed)) ? Number(data.speed) * 3.6 : undefined;
    const routerTs = Number.isFinite(Number(data.timestamp)) && Number(data.timestamp) > 0 ? Number(data.timestamp) * 1000 : null;
    return {
        ok: true,
        routerTs,
        fix: { coords: { latitude, longitude, accuracy: 15, speed }, timestamp: routerTs ?? undefined }
    };
}

/** Résume les échecs de chaque endpoint essayé, sans doublon. */
export function describeSncfFailures(failures) {
    return [...new Set(failures.map(f => f.message))].join(' ; ') || FAILURE_MESSAGES.unreachable;
}

/** État par session : endpoint retenu, dernier horodatage routeur, dernier échec, tentative de retour en vol. */
export function createSncfTracker() {
    return { url: null, routerTs: null, advancedAt: null, failedAt: null, lastError: null, probing: false };
}

/**
 * Fraîcheur d'une position reçue. Mesurée sur l'horloge du téléphone depuis la
 * dernière avancée de l'horodatage routeur, jamais par différence entre les
 * deux horloges (dérive inconnue du routeur).
 * @returns {'fresh'|'duplicate'|'stale'} `duplicate` : rien de neuf à ingérer.
 */
export function noteSncfFix(tracker, routerTs, nowTs) {
    if (routerTs == null || routerTs !== tracker.routerTs || tracker.advancedAt == null) {
        tracker.routerTs = routerTs;
        tracker.advancedAt = nowTs;
        return 'fresh';
    }
    return nowTs - tracker.advancedAt > SNCF_STALE_MS ? 'stale' : 'duplicate';
}

/**
 * Source à interroger à ce tick. En repli GPS d'une configuration SNCF, un
 * tick sur SNCF_RETRY_MS retente le WiFi SNCF ; les autres restent au GPS.
 * @param {{preferred:string, active:string, failedAt:number|null}} s
 */
export function pickLocationSource({ preferred, active, failedAt }, nowTs) {
    if (active === 'sncf' || preferred !== 'sncf') return active;
    return failedAt == null || nowTs - failedAt >= SNCF_RETRY_MS ? 'sncf' : active;
}
