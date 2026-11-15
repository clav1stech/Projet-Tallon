// js/tracking-session.js
// Session de tracking du mode train, sans DOM : acquisition des fixes,
// accrochage au trajet appliqué, rejeu, et vues de données pour l'affichage.
//
// Deux étages volontairement séparés :
//   acceptFix()      fix brut → échantillon. Ne dépend QUE des acquisitions
//                    passées (précision, anti-téléportation, vitesse) : aucune
//                    reconfiguration du trajet ne l'affecte.
//   advanceOnRoute() échantillon × trajet appliqué → résultats dérivés
//                    (segment, franchissements, retard). Déterministe : rejouer
//                    les mêmes échantillons sur le même trajet redonne le même
//                    état, ce qui fonde replaySession().
//
// Toutes les fonctions reçoivent l'état (forme de STATE, js/state.js) en
// paramètre : testables sans singleton ni navigateur.

import { createSessionState } from './state.js';
import { haversineDistance } from './geo.js';
import {
    computeCurrentDelay,
    computeSegmentIndexAndDistance,
    findNearestSegmentIndex,
    projectPositionOnRouteSegment
} from './functions.js';
import { evaluateTeleport, filterSpeedSpike, medianStepSpeed, noiseFloorKmh, shouldAcceptAccuracy } from './tracking.js';
import { alignDelayForDisplay } from './utils.js';
import {
    ARRIVAL_SNAP_KM,
    MAX_TRAIN_SPEED_KMH,
    POSITION_WINDOW_SIZE,
    SESSION_MAX_SAMPLES,
    SIGNAL_LOSS_MAX_MS,
    SIGNAL_LOSS_MIN_MS
} from './train-config.js';

// ───────────────────────── Cycle de vie ─────────────────────────

/** Remet à zéro les seuls résultats dérivés ; les acquisitions sont intactes. */
export function resetDerivedTracking(state) {
    state.lastSegmentIndex = null;
    state.passageTimes = {};
    state.passedPoints = {};
    state.passedPointMarkers = [];
    state.currentDelay = 0;
    state.trackingSnapshot = null;
}

/** Installe un plan de trajet (trip-config.js) comme trajet suivi. */
export function installTripPlan(state, plan) {
    state.tripPlan = plan;
    state.planRevision = (state.planRevision || 0) + 1;
    state.currentRoute = plan.route;
    state.direction = plan.direction;
    state.selectedPatternId = plan.patternId;
    state.departureTime = plan.config?.departureTime || '';
    state.departureTimestamp = plan.departureTimestamp;
    state.globalDeltaSeconds = plan.config?.globalDeltaSeconds || 0;
}

export function clearTripPlan(state) {
    state.tripPlan = null;
    state.planRevision = (state.planRevision || 0) + 1;
    state.currentRoute = [];
    state.selectedPatternId = '';
    state.departureTime = '';
    state.departureTimestamp = null;
    state.globalDeltaSeconds = 0;
}

export function startSession(state, nowTs = Date.now()) {
    state.session = createSessionState();
    state.session.active = true;
    state.session.startedAt = nowTs;
    resetDerivedTracking(state);
}

export function endSession(state) {
    state.session = createSessionState();
    resetDerivedTracking(state);
}

function pushSample(session, sample) {
    session.samples.push(sample);
    if (session.samples.length > SESSION_MAX_SAMPLES) session.samples.shift();
}

function lastSampleSpeed(session) {
    const last = session.samples[session.samples.length - 1];
    return last ? last.v : null;
}

// ───────────────────────── Acquisition ─────────────────────────

/**
 * Filtre un fix (format navigator.geolocation) et l'ajoute à l'historique.
 * Chaîne : précision → anti-téléportation (avec ré-ancrage) → vitesse médiane
 * → plancher de bruit → anti-pic → clamp.
 *
 * @param {object} opts
 * @param {string}   opts.locationMethod - source active ('geo' | 'sncf')
 * @param {number}   [opts.speedDivisor] - positions accélérées ×N (fakeGeoSim)
 * @returns {{accepted:false, reason:'inactive'|'invalid'|'accuracy'|'teleport', accuracyMeters?:number}
 *         | {accepted:true, sample:object}}
 */
export function acceptFix(state, position, nowTs = Date.now(), opts = {}) {
    const session = state.session;
    if (!session.active) return { accepted: false, reason: 'inactive' };

    const lat = position?.coords?.latitude;
    const lon = position?.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { accepted: false, reason: 'invalid' };

    session.lastGpsUpdateMs = nowTs;
    const accuracyMeters = Number(position.coords.accuracy);

    // Rebonds imprécis (positionnement cellulaire post-tunnel) rejetés, sauf
    // en mode dégradé (disette de fix prolongée).
    if (!shouldAcceptAccuracy(accuracyMeters, session.lastAcceptedFixMs || 0, nowTs)) {
        return { accepted: false, reason: 'accuracy', accuracyMeters };
    }

    // Positions physiquement impossibles ignorées ; si elles persistent (app
    // suspendue par iOS puis réveillée ailleurs), le suivi est ré-ancré.
    const verdict = evaluateTeleport(session.lastTrustedPosition, lat, lon, nowTs, session.teleportRejections || 0);
    session.teleportRejections = verdict.rejections;
    if (!verdict.accept) {
        session.gpsRecoveryMode = true;
        return { accepted: false, reason: 'teleport' };
    }
    session.gpsRecoveryMode = false;
    if (verdict.reseeded) session.lastPositions = [];
    session.lastTrustedPosition = { lat, lon, ts: nowTs };
    session.lastAcceptedFixMs = nowTs;

    session.lastPositions.push({ lat, lon, ts: nowTs });
    if (session.lastPositions.length > POSITION_WINDOW_SIZE) session.lastPositions.shift();

    // Vitesse fournie par le train (WiFi SNCF) : une valeur absente n'est pas
    // une vitesse nulle.
    const rawSpeed = position.coords.speed;
    const reportedSpeed = Number(rawSpeed);
    const hasDirectSpeed = opts.locationMethod === 'sncf' && rawSpeed != null && rawSpeed !== '' &&
        Number.isFinite(reportedSpeed) && reportedSpeed >= 0;

    let speed = hasDirectSpeed ? reportedSpeed : 0;
    if (!hasDirectSpeed && session.lastPositions.length >= 2) {
        speed = medianStepSpeed(session.lastPositions);
        // À l'arrêt en gare, le jitter GPS produit une vitesse fantôme
        // (±30 m sur 10 s ≈ 11 km/h) : sous le plancher, vitesse nulle.
        const first = session.lastPositions[0];
        const last = session.lastPositions[session.lastPositions.length - 1];
        if (speed < noiseFloorKmh(accuracyMeters, (last.ts - first.ts) / 1000)) speed = 0;
    }

    const divisor = Number(opts.speedDivisor) || 1;
    if (divisor !== 1) speed = speed / divisor;

    const prevSpeed = lastSampleSpeed(session);
    speed = filterSpeedSpike(prevSpeed == null ? speed : prevSpeed, speed);
    speed = Math.max(0, Math.min(MAX_TRAIN_SPEED_KMH, speed));

    const sample = {
        ts: nowTs,
        v: speed,
        reliable: true,
        lat,
        lon,
        accuracyM: Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters : null,
        speedReliable: hasDirectSpeed || (opts.locationMethod === 'geo' && session.lastPositions.length >= 2),
        reseeded: verdict.reseeded,
        routeKm: null
    };
    pushSample(session, sample);
    return { accepted: true, sample };
}

/**
 * À appeler à chaque tick : sans fix depuis SIGNAL_LOSS_MIN_MS, prolonge
 * l'historique d'un échantillon non fiable (dernière vitesse connue).
 * @returns {boolean} true si un échantillon de perte a été ajouté
 */
export function recordSignalLossTick(state, nowTs = Date.now()) {
    const session = state.session;
    if (!session.active || !(session.lastGpsUpdateMs > 0)) return false;
    const silence = nowTs - session.lastGpsUpdateMs;
    if (silence <= SIGNAL_LOSS_MIN_MS || silence >= SIGNAL_LOSS_MAX_MS) return false;
    pushSample(session, { ts: nowTs, v: lastSampleSpeed(session) ?? 0, reliable: false });
    return true;
}

// ───────────────────────── Accrochage au trajet ─────────────────────────

/**
 * Applique un échantillon de position au trajet appliqué et met à jour les
 * résultats dérivés. Les instants utilisés sont ceux de l'échantillon, jamais
 * l'horloge : la fonction donne le même résultat en direct et au rejeu.
 *
 * @param {object} [opts] - { onPassage(point, delayMs) } : notification des
 *   franchissements (journalisation en direct, omise au rejeu)
 * @returns {object|null} snapshot affichable, ou null si la position est hors
 *   du trajet (l'état dérivé précédent est alors conservé)
 */
export function advanceOnRoute(state, sample, opts = {}) {
    const route = state.currentRoute;
    const plan = state.tripPlan;
    if (!plan || !route || route.length < 2 || state.departureTimestamp == null) return null;

    const { lat, lon, ts } = sample;
    sample.routeKm = null;

    // Premier fix ou ré-ancrage : accrochage par projection sur tout le trajet
    // (le voyageur peut démarrer le suivi en cours de route).
    if (sample.reseeded) state.lastSegmentIndex = null;
    if (state.lastSegmentIndex === null) {
        state.lastSegmentIndex = findNearestSegmentIndex(route, lat, lon);
    }

    let { segmentIndex, distanceFromSegmentStart, distanceToNextPointKm } = computeSegmentIndexAndDistance(
        route, lat, lon, state.lastSegmentIndex, sample.accuracyM, state.direction
    );
    if (segmentIndex === null || segmentIndex < 0) return null;

    // Garde-fou unidirectionnel : l'index de segment ne recule jamais. Les
    // distances sont reprojetées sur le segment retenu, sinon le retard
    // utiliserait une distance mesurée sur un autre segment.
    if (segmentIndex < state.lastSegmentIndex) {
        segmentIndex = state.lastSegmentIndex;
        const projection = projectPositionOnRouteSegment(route, segmentIndex, lat, lon);
        distanceFromSegmentStart = projection.distanceFromSegmentStart;
        distanceToNextPointKm = projection.distanceToNextPointKm;
    }

    const theoreticalTs = (idx) => state.departureTimestamp + plan.offsetsSeconds[idx] * 1000;
    const recordPassage = (idx, withMarker) => {
        const point = route[idx];
        if (!point || Object.prototype.hasOwnProperty.call(state.passageTimes, point.id)) return;
        state.passageTimes[point.id] = ts;
        state.passedPoints[point.id] = ts - theoreticalTs(idx);
        if (withMarker) state.passedPointMarkers.push({ pointId: point.id, name: point.name, ts });
        if (opts.onPassage) opts.onPassage(point, state.passedPoints[point.id]);
    };

    for (let i = state.lastSegmentIndex + 1; i <= segmentIndex; i++) recordPassage(i, true);
    if (segmentIndex > state.lastSegmentIndex) state.lastSegmentIndex = segmentIndex;

    let currentDelayMs = computeCurrentDelay(route, segmentIndex, distanceFromSegmentStart, state.departureTimestamp, ts);

    // Arrivée : sur le dernier segment et tout près du terminus, celui-ci
    // devient le point actif.
    const lastRouteIdx = route.length - 1;
    let displayIdx = segmentIndex;
    if (segmentIndex === lastRouteIdx - 1 && distanceToNextPointKm < ARRIVAL_SNAP_KM) {
        displayIdx = lastRouteIdx;
        recordPassage(lastRouteIdx, false);
    }

    // Gel du retard à l'arrivée : une fois le terminus franchi, le retard est
    // celui constaté au passage — sinon il croîtrait tant que le train reste à quai.
    const terminus = route[lastRouteIdx];
    if (terminus && state.passedPoints[terminus.id] != null) {
        currentDelayMs = state.passedPoints[terminus.id];
    }
    state.currentDelay = currentDelayMs;

    const anchor = route[displayIdx];
    sample.routeKm = plan.cumKm[segmentIndex] + distanceFromSegmentStart;

    state.trackingSnapshot = {
        ts,
        lat,
        lon,
        accuracyM: sample.accuracyM,
        segmentIndex,
        displayIdx,
        progress: { distanceFromSegmentStart, distanceToNextPointKm },
        routeKm: sample.routeKm,
        lastPointDistanceKm: anchor && typeof anchor.lat === 'number'
            ? haversineDistance(anchor.lat, anchor.lon, lat, lon)
            : 0,
        speedKmh: sample.v,
        speedReliable: sample.speedReliable,
        currentDelayMs
    };
    return state.trackingSnapshot;
}

/**
 * Point d'entrée d'un fix en direct : acquisition puis accrochage.
 * @returns {{accepted:boolean, reason?:string, sample?:object, snapshot?:object|null}}
 *   `snapshot: null` avec `accepted: true` = position hors du trajet prévu
 */
export function ingestFix(state, position, nowTs = Date.now(), opts = {}) {
    const result = acceptFix(state, position, nowTs, opts);
    if (!result.accepted) return result;
    return { ...result, snapshot: advanceOnRoute(state, result.sample, opts) };
}

/**
 * Recalcule tous les résultats dérivés à partir de l'historique brut et du
 * trajet actuellement installé. C'est la stratégie de resynchronisation après
 * une reconfiguration : franchissements, écarts et position sont réévalués
 * contre le nouveau plan avec les instants réellement observés, sans qu'un
 * seul échantillon ni l'état des garde-fous d'acquisition ne soit touché.
 */
export function replaySession(state) {
    resetDerivedTracking(state);
    for (const sample of state.session.samples) {
        if (Number.isFinite(sample.lat)) advanceOnRoute(state, sample);
    }
    return state.trackingSnapshot;
}

// ───────────────────────── Vues de données ─────────────────────────

/**
 * État de la localisation.
 * `signal` : 'idle' (pas de session) | 'waiting' (aucun fix reçu) | 'lost'
 * | 'recovering' (positions incohérentes en cours de rejet) | 'off-route'
 * | 'ok'.
 */
export function getLocationStatus(state, nowTs = Date.now()) {
    const session = state.session;
    const base = { source: state.locationMethod, signal: 'idle', lastFixTs: null, ageMs: null, accuracyM: null };
    if (!session.active) return base;
    if (!(session.lastGpsUpdateMs > 0)) return { ...base, signal: 'waiting' };

    const ageMs = nowTs - session.lastGpsUpdateMs;
    let lastFix = null;
    for (let i = session.samples.length - 1; i >= 0 && !lastFix; i--) {
        if (Number.isFinite(session.samples[i].lat)) lastFix = session.samples[i];
    }
    let signal = 'ok';
    if (ageMs > SIGNAL_LOSS_MIN_MS) signal = 'lost';
    else if (session.gpsRecoveryMode) signal = 'recovering';
    else if (lastFix && lastFix.routeKm == null) signal = 'off-route';
    return { source: state.locationMethod, signal, lastFixTs: session.lastGpsUpdateMs, ageMs, accuracyM: lastFix?.accuracyM ?? null };
}

/**
 * Franchissements constatés, dans l'ordre du trajet appliqué, avec leur écart
 * historique à l'horaire.
 */
export function getPassageLog(state) {
    const plan = state.tripPlan;
    if (!plan) return [];
    const log = [];
    plan.route.forEach((point, idx) => {
        if (!Object.prototype.hasOwnProperty.call(state.passageTimes, point.id)) return;
        log.push({
            pointId: point.id,
            name: point.name,
            isStop: !!point.isStop,
            routeIndex: idx,
            km: plan.cumKm[idx],
            ts: state.passageTimes[point.id],
            theoreticalTs: state.departureTimestamp + plan.offsetsSeconds[idx] * 1000,
            delayMs: state.passedPoints[point.id]
        });
    });
    return log;
}

/**
 * Données du graphe de vitesse intégral.
 *  - `samples` : tout l'historique de la session (référence directe, lecture
 *    seule) — `ts`, `v`, `reliable`, `routeKm` (null hors trajet / sans signal) ;
 *  - `planned` : vitesse moyenne prévue par l'horaire sur chaque segment ;
 *  - `stops` : gares desservies, pour graduer l'axe en km ;
 *  - `passages` : écarts constatés aux points franchis.
 */
export function buildSpeedProfile(state) {
    const plan = state.tripPlan;
    const samples = state.session.samples;
    if (!plan) return { samples, planned: [], stops: [], passages: [], totalKm: 0, currentKm: null, maxKmh: 0 };

    const planned = [];
    for (let i = 0; i < plan.route.length - 1; i++) {
        const seconds = plan.offsetsSeconds[i + 1] - plan.offsetsSeconds[i];
        const km = plan.cumKm[i + 1] - plan.cumKm[i];
        planned.push({ fromKm: plan.cumKm[i], toKm: plan.cumKm[i + 1], kmh: seconds > 0 ? km / seconds * 3600 : 0 });
    }
    const stops = [];
    plan.route.forEach((point, idx) => {
        if (point.isStop) stops.push({ id: point.id, name: point.name, km: plan.cumKm[idx] });
    });
    let maxKmh = 0;
    for (const s of samples) if (s.reliable && s.v > maxKmh) maxKmh = s.v;

    return {
        samples,
        planned,
        stops,
        passages: getPassageLog(state),
        totalKm: plan.totalKm,
        currentKm: state.trackingSnapshot?.routeKm ?? null,
        maxKmh
    };
}

/**
 * Modèle du cockpit : tout ce que la vue de suivi affiche hors carousel,
 * calculé depuis l'état — aucun horaire n'est à recalculer côté rendu.
 * @returns {object|null} null hors session
 */
export function buildCockpitModel(state, nowTs = Date.now()) {
    const plan = state.tripPlan;
    if (!plan || !state.session.active) return null;

    const snapshot = state.trackingSnapshot;
    const route = plan.route;
    const lastIdx = route.length - 1;
    const location = getLocationStatus(state, nowTs);
    const theoreticalTs = (idx) => plan.departureTimestamp + plan.offsetsSeconds[idx] * 1000;

    const arrived = Object.prototype.hasOwnProperty.call(state.passageTimes, route[lastIdx].id);
    const beforeDeparture = !arrived && nowTs < plan.departureTimestamp;
    const delayMs = snapshot ? state.currentDelay : 0;
    // Même règle que la pilule de retard et les heures projetées : sous les
    // seuils d'affichage, les heures restent théoriques.
    const displayDelayMs = beforeDeparture ? 0 : alignDelayForDisplay(delayMs);

    const currentIdx = snapshot ? snapshot.displayIdx : 0;
    const routeKm = snapshot ? snapshot.routeKm : null;

    let nextStop = null;
    for (let i = currentIdx + 1; i <= lastIdx && !nextStop; i++) {
        if (!route[i].isStop) continue;
        const estimatedTs = theoreticalTs(i) + displayDelayMs;
        nextStop = {
            id: route[i].id,
            name: route[i].name,
            routeIndex: i,
            isTerminus: i === lastIdx,
            theoreticalTs: theoreticalTs(i),
            estimatedTs,
            distanceKm: routeKm == null ? null : Math.max(0, plan.cumKm[i] - routeKm),
            remainingSeconds: Math.max(0, Math.round((estimatedTs - nowTs) / 1000))
        };
    }

    // Statistiques mesurées sur la session (et non depuis l'origine : le
    // suivi peut avoir démarré en cours de route).
    let maxKmh = 0;
    let first = null;
    let last = null;
    for (const s of state.session.samples) {
        if (s.reliable && s.v > maxKmh) maxKmh = s.v;
        if (s.routeKm != null) { if (!first) first = s; last = s; }
    }
    const hours = first && last ? (last.ts - first.ts) / 3_600_000 : 0;

    return {
        phase: arrived ? 'arrived' : (beforeDeparture ? 'before-departure' : 'running'),
        speedKmh: snapshot ? snapshot.speedKmh : null,
        speedReliable: !!snapshot && snapshot.speedReliable && location.signal !== 'lost',
        delayMs,
        displayDelayMs,
        departure: { theoreticalTs: plan.departureTimestamp },
        arrival: { theoreticalTs: theoreticalTs(lastIdx), estimatedTs: theoreticalTs(lastIdx) + displayDelayMs },
        progress: {
            currentIdx,
            doneKm: routeKm,
            leftKm: routeKm == null ? null : Math.max(0, plan.totalKm - routeKm),
            totalKm: plan.totalKm,
            ratio: routeKm == null || plan.totalKm <= 0 ? 0 : Math.max(0, Math.min(1, routeKm / plan.totalKm))
        },
        nextStop,
        stats: { maxKmh, avgKmh: hours > 0 ? (last.routeKm - first.routeKm) / hours : 0 },
        location
    };
}
