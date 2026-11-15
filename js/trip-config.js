// js/trip-config.js
// Configuration d'un trajet et horaires qui en découlent. Calcul PUR : aucun
// accès au DOM ni à STATE, donc utilisable aussi bien pour l'aperçu de
// l'accueil (configuration provisoire) que pour la session (configuration
// appliquée) sans que l'un n'influence l'autre.

import { MAIN_ROUTES } from './routes-config.js';
import { buildEffectiveRoute } from './functions.js';
import { buildCumulativeDistances } from './geo.js';
import { formatTime } from './utils.js';
import { DELTA_MAX_MINUTES, DELTA_MIN_MINUTES, DEPARTURE_DAY_ROLLOVER_MS } from './train-config.js';

const DAY_MS = 86_400_000;

/**
 * Forme canonique d'une configuration : deux configurations équivalentes
 * donnent des objets identiques champ à champ (arrêts dans l'ordre de
 * `MAIN_ROUTES`, sans doublon ni arrêt étranger à la liaison).
 */
export function createTripConfig(raw = {}) {
    const mainRouteKey = MAIN_ROUTES[raw.mainRouteKey] ? raw.mainRouteKey : '';
    const requested = new Set(Array.isArray(raw.stopIds) ? raw.stopIds : []);
    const stopIds = mainRouteKey
        ? MAIN_ROUTES[mainRouteKey].stopOptions.map(s => s.id).filter(id => requested.has(id))
        : [];
    const departureTime = /^\d{1,2}:\d{2}$/.test(raw.departureTime || '') ? raw.departureTime : '';
    const delta = Number(raw.globalDeltaSeconds);
    const globalDeltaSeconds = Number.isFinite(delta)
        ? Math.max(DELTA_MIN_MINUTES * 60, Math.min(DELTA_MAX_MINUTES * 60, Math.round(delta)))
        : 0;
    const locationMethod = raw.locationMethod === 'sncf' ? 'sncf' : 'geo';
    return { mainRouteKey, stopIds, departureTime, globalDeltaSeconds, locationMethod };
}

/**
 * Écarts entre deux configurations, par nature d'impact :
 * `route` change la géométrie, `schedule` seulement les horaires, `source`
 * seulement le moyen de localisation.
 */
export function diffTripConfig(prev, next) {
    const a = createTripConfig(prev || {});
    const b = createTripConfig(next || {});
    const route = a.mainRouteKey !== b.mainRouteKey;
    const schedule = route ||
        a.stopIds.join(',') !== b.stopIds.join(',') ||
        a.departureTime !== b.departureTime ||
        a.globalDeltaSeconds !== b.globalDeltaSeconds;
    const source = a.locationMethod !== b.locationMethod;
    return { route, schedule, source, any: schedule || source };
}

export function tripConfigsEqual(a, b) {
    return !diffTripConfig(a, b).any;
}

/**
 * Pattern de desserte construit à la volée pour la sélection : les arrêts
 * suivent l'ordre réel des points du trajet, quel que soit l'ordre de saisie.
 * @returns {object|null} null si la liaison est inconnue ou absente des données
 */
export function buildPatternFromConfig(config, trajets) {
    const cfg = MAIN_ROUTES[config?.mainRouteKey];
    if (!cfg) return null;
    const trajet = (trajets || []).find(t => t.id === cfg.masterRouteId);
    const ids = (trajet?.points || []).map(pt => pt.id);
    const startIndex = ids.indexOf(cfg.startPointId);
    const endIndex = ids.indexOf(cfg.endPointId);
    if (startIndex === -1 || endIndex === -1) return null;

    const allowed = new Set(cfg.stopOptions.map(s => s.id));
    const selected = new Set((config.stopIds || []).filter(id => allowed.has(id)));
    let slice = ids.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
    if (startIndex > endIndex) slice = slice.reverse();
    const orderedStops = slice.filter(id => selected.has(id) && id !== cfg.startPointId && id !== cfg.endPointId);

    return {
        id: `CUSTOM_${cfg.endPointId}_${orderedStops.join('_') || 'DIRECT'}`,
        label: cfg.label,
        masterRouteId: cfg.masterRouteId,
        startPointId: cfg.startPointId,
        endPointId: cfg.endPointId,
        stops: [cfg.startPointId, ...orderedStops, cfg.endPointId],
        deltaSeconds: 0
    };
}

/**
 * Timestamp de départ d'une heure « HH:MM », rattachée au jour de
 * `referenceTs` — ou au jour voisin si elle s'en éloigne trop (départ à 23:40,
 * référence à 00:10 : le train est parti la veille).
 * @returns {number|null}
 */
export function resolveDepartureTimestamp(timeStr, referenceTs = Date.now()) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const [h, m] = timeStr.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const d = new Date(referenceTs);
    d.setHours(h, m, 0, 0);
    // Décalage par date calendaire (et non ±24 h) : exact aux changements d'heure.
    if (d.getTime() - referenceTs > DEPARTURE_DAY_ROLLOVER_MS) d.setDate(d.getDate() - 1);
    else if (referenceTs - d.getTime() > DEPARTURE_DAY_ROLLOVER_MS) d.setDate(d.getDate() + 1);
    return d.getTime();
}

/**
 * Plan de trajet complet pour une configuration : route effective du moteur
 * existant, cumuls horaires et kilométriques, heure de départ datée.
 *
 * `status` :
 *  - 'no-route'          aucune liaison choisie
 *  - 'data-unavailable'  données de ligne absentes ou incohérentes
 *  - 'no-departure'      route calculée mais heure de départ manquante
 *                        (durées connues, horaires non datables)
 *  - 'ok'
 *
 * @param {object} config
 * @param {{points:Object, trajets:Array}} data
 * @param {number} [referenceTs] - instant de rattachement du jour de départ
 */
export function buildTripPlan(config, data, referenceTs = Date.now()) {
    const cfg = createTripConfig(config);
    const empty = {
        config: cfg, patternId: '', route: [], direction: 'SUD',
        offsetsSeconds: [], cumKm: [], totalSeconds: 0, totalKm: 0, departureTimestamp: null
    };
    if (!cfg.mainRouteKey) return { status: 'no-route', ...empty };

    const trajets = data?.trajets || [];
    const pattern = buildPatternFromConfig(cfg, trajets);
    if (!pattern) return { status: 'data-unavailable', ...empty };

    let built;
    try {
        built = buildEffectiveRoute(pattern.id, cfg.globalDeltaSeconds, data?.points || {}, trajets, [pattern]);
    } catch (e) {
        return { status: 'data-unavailable', ...empty };
    }
    const route = built.points || [];
    if (route.length < 2 || route.some(p => typeof p.lat !== 'number' || typeof p.lon !== 'number')) {
        return { status: 'data-unavailable', ...empty };
    }

    const offsetsSeconds = [0];
    for (let i = 0; i < route.length - 1; i++) {
        offsetsSeconds.push(offsetsSeconds[i] + Number(route[i].durationEffective ?? 0));
    }
    const cumKm = buildCumulativeDistances(route);
    const departureTimestamp = resolveDepartureTimestamp(cfg.departureTime, referenceTs);

    return {
        status: departureTimestamp == null ? 'no-departure' : 'ok',
        config: cfg,
        patternId: pattern.id,
        route,
        direction: built.direction || 'SUD',
        offsetsSeconds,
        cumKm,
        totalSeconds: offsetsSeconds[offsetsSeconds.length - 1],
        totalKm: cumKm[cumKm.length - 1],
        departureTimestamp
    };
}

/** Nombre de jours calendaires entre deux instants (0 = même jour). */
function calendarDayOffset(fromTs, toTs) {
    const a = new Date(fromTs); a.setHours(0, 0, 0, 0);
    const b = new Date(toTs); b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * Synthèse de desserte : uniquement les gares commerciales où le train
 * s'arrête (origine, arrêts sélectionnés, terminus), avec leurs horaires
 * issus du plan. `time`/`timestamp` valent null tant que l'heure de départ
 * manque ; `dayOffset` > 0 signale une heure après minuit (J+1).
 *
 * `stopOptions` liste, dans l'ordre du parcours, tous les arrêts que la
 * liaison permet (desservis ou non) pour les commandes d'ajout/retrait.
 */
export function buildServiceSummary(plan) {
    const base = { status: plan?.status || 'no-route', stops: [], stopOptions: [], intermediateStopCount: 0, totalSeconds: 0, totalKm: 0 };
    if (!plan || !plan.route.length) return base;

    const { route, offsetsSeconds, cumKm, departureTimestamp } = plan;
    const lastIdx = route.length - 1;
    const stops = [];
    route.forEach((point, idx) => {
        if (!point.isStop) return;
        const prev = stops[stops.length - 1] || null;
        const timestamp = departureTimestamp == null ? null : departureTimestamp + offsetsSeconds[idx] * 1000;
        stops.push({
            id: point.id,
            name: point.name,
            role: idx === 0 ? 'origin' : (idx === lastIdx ? 'terminus' : 'stop'),
            routeIndex: idx,
            offsetSeconds: offsetsSeconds[idx],
            km: cumKm[idx],
            timestamp,
            time: timestamp == null ? null : formatTime(new Date(timestamp)),
            dayOffset: timestamp == null ? 0 : calendarDayOffset(departureTimestamp, timestamp),
            legSeconds: prev ? offsetsSeconds[idx] - prev.offsetSeconds : 0,
            legKm: prev ? cumKm[idx] - prev.km : 0
        });
    });

    const options = MAIN_ROUTES[plan.config.mainRouteKey]?.stopOptions || [];
    const labels = new Map(options.map(s => [s.id, s.label]));
    const selected = new Set(plan.config.stopIds);
    const stopOptions = [];
    route.forEach((point, idx) => {
        if (!labels.has(point.id) || idx === 0 || idx === lastIdx) return;
        stopOptions.push({ id: point.id, label: labels.get(point.id), routeIndex: idx, selected: selected.has(point.id) });
    });

    return {
        status: plan.status,
        stops,
        stopOptions,
        intermediateStopCount: Math.max(0, stops.length - 2),
        totalSeconds: plan.totalSeconds,
        totalKm: plan.totalKm
    };
}
