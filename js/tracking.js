// js/tracking.js
// Helpers PURS de fiabilité GPS : aucun accès au DOM ni à STATE, pour être
// testables hors conditions réelles (Vitest) et réutilisés par app.js.

import { haversineDistance } from './geo.js';

// Précision au-delà de laquelle un fix est considéré comme un rebond
// (positionnement cellulaire post-tunnel, WiFi dégradé...).
export const MAX_ACCEPTABLE_ACCURACY_M = 800;

// Après ce délai sans aucun fix accepté, on accepte même un fix imprécis
// (mode dégradé : mieux vaut une position approximative que rien du tout).
export const ACCURACY_OVERRIDE_MS = 30_000;

// Vitesse implicite au-delà de laquelle un fix est une téléportation.
export const TELEPORT_THRESHOLD_KMH = 2000;

// Nombre de rejets consécutifs avant de considérer que la "téléportation"
// est en fait la réalité (le train a vraiment bougé, ex: réveil de l'app).
export const TELEPORT_MAX_REJECTIONS = 3;

/**
 * Décide si un fix GPS doit être accepté au vu de sa précision.
 * - Une précision non renseignée (WiFi SNCF, bridge) est acceptée.
 * - Un fix imprécis est rejeté, SAUF si aucun fix n'a été accepté depuis
 *   ACCURACY_OVERRIDE_MS (tunnel long : on prend ce qu'on a).
 * @param {number} accuracyMeters
 * @param {number} lastAcceptedTs - timestamp ms du dernier fix accepté (0 si aucun)
 * @param {number} nowTs
 * @param {object} [opts] - { maxAccuracyM, overrideMs }
 * @returns {boolean}
 */
export function shouldAcceptAccuracy(accuracyMeters, lastAcceptedTs, nowTs, opts = {}) {
    const maxAccuracyM = opts.maxAccuracyM ?? MAX_ACCEPTABLE_ACCURACY_M;
    const overrideMs = opts.overrideMs ?? ACCURACY_OVERRIDE_MS;

    if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return true;
    if (accuracyMeters <= maxAccuracyM) return true;

    // Mode dégradé : disette de fix prolongée, on accepte l'imprécis.
    if (!lastAcceptedTs || nowTs - lastAcceptedTs >= overrideMs) return true;

    return false;
}

/**
 * Guard anti-téléportation avec récupération.
 * Comportement historique conservé : un fix impliquant > 2000 km/h est rejeté.
 * Ajout : après TELEPORT_MAX_REJECTIONS rejets consécutifs, le fix est accepté
 * avec `reseeded: true` — l'appelant doit alors ré-ancrer le tracking
 * (le train a réellement changé de position, ex: app suspendue par iOS).
 * @param {{lat:number, lon:number, ts:number}|null} lastTrusted
 * @param {number} lat
 * @param {number} lon
 * @param {number} nowTs
 * @param {number} rejections - compteur de rejets consécutifs courant
 * @param {object} [opts] - { thresholdKmh, maxRejections }
 * @returns {{ accept: boolean, reseeded: boolean, rejections: number }}
 */
export function evaluateTeleport(lastTrusted, lat, lon, nowTs, rejections = 0, opts = {}) {
    const thresholdKmh = opts.thresholdKmh ?? TELEPORT_THRESHOLD_KMH;
    const maxRejections = opts.maxRejections ?? TELEPORT_MAX_REJECTIONS;

    if (!lastTrusted) {
        return { accept: true, reseeded: false, rejections: 0 };
    }

    const dtH = (nowTs - lastTrusted.ts) / 3_600_000;
    const impliedSpeed = dtH > 0
        ? haversineDistance(lat, lon, lastTrusted.lat, lastTrusted.lon) / dtH
        : 0;

    if (impliedSpeed <= thresholdKmh) {
        return { accept: true, reseeded: false, rejections: 0 };
    }

    const nextRejections = rejections + 1;
    if (nextRejections >= maxRejections) {
        // Le fix "impossible" persiste : c'est lui la nouvelle réalité.
        return { accept: true, reseeded: true, rejections: 0 };
    }
    return { accept: false, reseeded: false, rejections: nextRejections };
}

// Écart position→corridor au-delà duquel le matching devient suspect
// (le matcher peut snapper jusqu'à POINT_MATCH_TOLERANCE_KM = 0.9 km ;
// un écart durable au-delà de 0.5 km signale un mauvais accrochage).
export const CORRIDOR_OFFSET_WARN_KM = 0.5;

// Nombre de ticks consécutifs au-dessus du seuil avant d'alerter : un écart
// ponctuel (rebond GPS, courbe serrée) ne doit pas déclencher.
export const CORRIDOR_OFFSET_WARN_TICKS = 5;

/**
 * Garde-fou d'écart au corridor, pendant analogique runtime de la coupe au
 * "premier saut aberrant" d'extract_pr.py : compte les ticks consécutifs où
 * l'écart position→corridor dépasse le seuil, et signale UNE fois par épisode
 * (au franchissement du N-ième tick) qu'un mauvais matching est probable.
 * @param {number|null} offsetKm - écart au corridor du tick courant
 * @param {number} streak - compteur de ticks consécutifs au-dessus du seuil
 * @param {object} [opts] - { warnKm, warnTicks }
 * @returns {{ streak: number, warn: boolean }}
 */
export function trackCorridorOffset(offsetKm, streak = 0, opts = {}) {
    const warnKm = opts.warnKm ?? CORRIDOR_OFFSET_WARN_KM;
    const warnTicks = opts.warnTicks ?? CORRIDOR_OFFSET_WARN_TICKS;

    if (!Number.isFinite(offsetKm) || offsetKm <= warnKm) {
        return { streak: 0, warn: false };
    }
    const nextStreak = streak + 1;
    return { streak: nextStreak, warn: nextStreak === warnTicks };
}

/**
 * Vitesse lissée : médiane des vitesses instantanées entre positions consécutives.
 * @param {Array<{lat:number, lon:number, ts:number}>} positions
 * @returns {number} vitesse en km/h (0 si indéterminable)
 */
export function medianStepSpeed(positions) {
    if (!positions || positions.length < 2) return 0;
    const stepSpeeds = [];
    for (let i = 1; i < positions.length; i++) {
        const a = positions[i - 1];
        const b = positions[i];
        const dt = (b.ts - a.ts) / 3_600_000;
        if (dt > 0) {
            stepSpeeds.push(haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt);
        }
    }
    if (stepSpeeds.length === 0) return 0;
    stepSpeeds.sort((a, b) => a - b);
    const mid = Math.floor(stepSpeeds.length / 2);
    return stepSpeeds.length % 2 === 1
        ? stepSpeeds[mid]
        : (stepSpeeds[mid - 1] + stepSpeeds[mid]) / 2;
}

/**
 * Plancher de bruit : vitesse fantôme maximale que le jitter GPS peut produire
 * sur la fenêtre d'observation. Un train À L'ARRÊT en gare avec une précision
 * de ±30 m sur 10 s peut afficher ~11 km/h de vitesse fantôme.
 * @param {number} accuracyMeters
 * @param {number} windowSeconds - durée couverte par l'historique de positions
 * @returns {number} seuil en km/h en dessous duquel la vitesse est du bruit
 */
export function noiseFloorKmh(accuracyMeters, windowSeconds) {
    if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 0;
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return 0;
    return (accuracyMeters / 1000) / (windowSeconds / 3600);
}

/**
 * Filtre de cohérence physique sur la vitesse (anti-pic GPS).
 * Comportement historique conservé : au-delà de 5 km/h d'écart entre deux
 * ticks, la vitesse évolue par pas de 2 km/h dans la direction du delta.
 * @param {number} prevSpeed
 * @param {number} nextSpeed
 * @returns {number}
 */
export function filterSpeedSpike(prevSpeed, nextSpeed) {
    const delta = nextSpeed - prevSpeed;
    if (Math.abs(delta) > 5) {
        return prevSpeed + Math.sign(delta) * 2;
    }
    return nextSpeed;
}
