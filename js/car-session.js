// js/car-session.js
// Session du mode voiture, sans DOM : mêmes frontières que le train
// (train-controller.js) entre navigation, configuration provisoire,
// configuration appliquée et session, avec les règles communes de
// session-flow.js.
//
//   showView()      navigation seule
//   setDraft()      configuration provisoire seule
//   launchSession() provisoire → appliquée, démarre la session
//   applyDraft()    provisoire → appliquée, session conservée
//   revertDraft()   appliquée → provisoire (abandon des modifications)
//   stopSession()   clôt la session
//
// La configuration voiture se réduit à l'itinéraire (et donc à son sens) :
// ni gares, ni horaires. L'acquisition GPS vit dans car-app.js, créée au
// lancement et détruite à la clôture, jamais ailleurs.

import { resolveHomeAction, resolveView } from './session-flow.js';

// Clé propre au mode voiture : les réglages du train ne sont jamais partagés.
export const CAR_ROUTE_STORAGE_KEY = 'car.routeKey';

const LABEL_SEPARATOR = ' → ';

export function createCarSessionState() {
    return {
        view: 'home',                      // 'home' | 'tracking'
        draftConfig: { routeKey: '' },
        appliedConfig: null,
        session: { active: false, startedAt: 0 }
    };
}

/** Départ et destination d'un itinéraire, lus dans son libellé « A → B ». */
export function routeEndpoints(routes, key) {
    const parts = routes[key]?.label?.split(LABEL_SEPARATOR);
    return parts?.length === 2 ? { origin: parts[0], destination: parts[1] } : null;
}

/** Itinéraire de sens opposé (mêmes extrémités), ou null s'il n'est pas déclaré. */
export function reverseRouteKey(routes, key) {
    const ends = routeEndpoints(routes, key);
    if (!ends) return null;
    return Object.keys(routes).find(other => {
        const o = routeEndpoints(routes, other);
        return o && o.origin === ends.destination && o.destination === ends.origin;
    }) ?? null;
}

/**
 * Trajets proposés : les deux sens d'une même liaison forment une seule
 * entrée, sans catalogue parallèle à CAR_ROUTES.
 * @returns {Array<{label:string, keys:string[]}>}
 */
export function listRoutePairs(routes) {
    const pairs = [];
    const seen = new Set();
    for (const key of Object.keys(routes)) {
        if (seen.has(key)) continue;
        const reverse = reverseRouteKey(routes, key);
        const ends = routeEndpoints(routes, key);
        const keys = reverse ? [key, reverse] : [key];
        keys.forEach(k => seen.add(k));
        pairs.push({ label: ends ? `${ends.origin} ↔ ${ends.destination}` : routes[key].label, keys });
    }
    return pairs;
}

export function setDraft(state, patch) {
    state.draftConfig = { ...state.draftConfig, ...patch };
    return state.draftConfig;
}

export function isDraftDirty(state) {
    return !!state.appliedConfig && state.appliedConfig.routeKey !== state.draftConfig.routeKey;
}

/**
 * @param {boolean} routeReady - l'itinéraire provisoire est chargé et valide
 */
export function getHomeAction(state, routeReady) {
    return resolveHomeAction({ active: state.session.active, dirty: isDraftDirty(state), valid: routeReady });
}

export function showView(state, view) {
    state.view = resolveView(view, state.session.active);
    return state.view;
}

/** Un second lancement ne réinitialise jamais la session. */
export function launchSession(state, routeReady, nowTs = Date.now()) {
    if (state.session.active) return { ok: false, reason: 'already-active' };
    if (!routeReady) return { ok: false, reason: 'route-unavailable' };
    state.session = { active: true, startedAt: nowTs };
    state.appliedConfig = { ...state.draftConfig };
    state.view = 'tracking';
    return { ok: true };
}

/**
 * Applique l'itinéraire provisoire à la session en cours. Rien n'est modifié
 * s'il est indisponible. `change: 'route'` signale à l'orchestrateur que la
 * progression le long de l'ancien itinéraire n'a plus de sens ; l'acquisition
 * GPS, elle, n'est jamais concernée.
 * @returns {{ok:true, change:'none'|'route'}|{ok:false, reason:string}}
 */
export function applyDraft(state, routeReady) {
    if (!state.session.active) return { ok: false, reason: 'no-session' };
    const change = isDraftDirty(state) ? 'route' : 'none';
    if (change === 'route' && !routeReady) return { ok: false, reason: 'route-unavailable' };
    state.appliedConfig = { ...state.draftConfig };
    state.view = 'tracking';
    return { ok: true, change };
}

export function revertDraft(state) {
    if (state.appliedConfig) state.draftConfig = { ...state.appliedConfig };
    return state.draftConfig;
}

/** Clôt la session ; l'itinéraire choisi reste dans le formulaire. */
export function stopSession(state) {
    state.session = { active: false, startedAt: 0 };
    state.appliedConfig = null;
    state.view = 'home';
}

/** Restaure l'itinéraire mémorisé, ou le premier déclaré. */
export function restoreCarSettings(state, routes, storage) {
    let stored = null;
    try { stored = storage.getItem(CAR_ROUTE_STORAGE_KEY); } catch { /* stockage indisponible */ }
    state.draftConfig = { routeKey: routes[stored] ? stored : (Object.keys(routes)[0] ?? '') };
}

export function saveCarSettings(state, storage) {
    try { storage.setItem(CAR_ROUTE_STORAGE_KEY, state.draftConfig.routeKey); } catch { /* stockage indisponible */ }
}

// ───────────────────────── Statistiques du trajet ─────────────────────────

export function createTripStats() {
    return { maxKmh: 0, firstTs: null, firstKm: null, lastTs: null, lastKm: null };
}

/**
 * Intègre une position MESURÉE. Les progressions extrapolées (tunnel, perte
 * de signal) n'y entrent jamais : la moyenne couvre le tunnel par ses deux
 * fix encadrants, sans rien inventer à l'intérieur.
 */
export function recordMeasuredFix(stats, { ts, routeKm, speedKmh, speedReliable }) {
    if (speedReliable && speedKmh > stats.maxKmh) stats.maxKmh = speedKmh;
    if (!Number.isFinite(routeKm)) return;
    if (stats.firstTs === null) { stats.firstTs = ts; stats.firstKm = routeKm; }
    stats.lastTs = ts;
    stats.lastKm = routeKm;
}

/** Moyenne mesurée depuis le premier fix de la session (suivi lancé en route compris). */
export function averageSpeedKmh(stats) {
    const hours = stats.firstTs === null ? 0 : (stats.lastTs - stats.firstTs) / 3_600_000;
    return hours > 0 ? (stats.lastKm - stats.firstKm) / hours : 0;
}
