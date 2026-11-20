// js/route-speed.js
// Profil de vitesse théorique d'un trajet de masterRoutes : distance, durée et
// vitesse moyenne de chaque segment, avec leur plausibilité. Calcul pur, sans
// DOM : partagé par l'éditeur de trajets, la page de profil et le test
// d'intégrité des données, pour qu'un segment jugé aberrant le soit partout.

import { haversineDistance } from './geo.js';
import { ROUTE_SPEED_BOUNDS_KMH } from './train-config.js';

/**
 * Coordonnées d'un point pour une voie, selon la règle de buildEffectiveRoute :
 * l'entrée propre au sens de circulation dès qu'elle est renseignée.
 */
export function routePointCoordinates(point, voie) {
    const lat = point?.[`lat_V${voie}`];
    const lon = point?.[`lon_V${voie}`];
    if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };
    return { lat: point?.lat, lon: point?.lon };
}

/**
 * PK SNCF en mètres : « 123+456 », « 123,456 », « 123.456 » ou nombre de km.
 * Une virgule ou un point suivi de trois chiffres sépare toujours km et mètres.
 */
export function parsePK(pk) {
    if (pk === null || pk === undefined) return null;
    const text = String(pk).trim();
    if (!text) return null;
    const plus = text.match(/^(\d+)\+(\d{3})$/);
    if (plus) return Number(plus[1]) * 1000 + Number(plus[2]);
    const decimal = text.match(/^(\d+)[.,](\d{3})$/);
    if (decimal) return Number(decimal[1]) * 1000 + Number(decimal[2]);
    const km = Number(text.replace(',', '.'));
    return Number.isFinite(km) ? Math.round(km * 1000) : null;
}

/** Repères linéaires d'un point pour une voie : [{ code, pk (m), slot }]. */
function pkEntries(point, voie) {
    if (!point) return [];
    if (point.type === 'bifurcation') {
        const secondLine = point.code_ligne_2 && point.code_ligne_2 !== point.code_ligne;
        return [
            { code: point.code_ligne, pk: parsePK(point[`PK_V${voie}`]), slot: 1 },
            { code: secondLine ? point.code_ligne_2 : '', pk: parsePK(point[`PK_2_V${voie}`]), slot: 2 }
        ].filter(entry => entry.code && entry.pk !== null);
    }
    const pk = parsePK(point.PK);
    return point.code_ligne && pk !== null ? [{ code: point.code_ligne, pk, slot: 1 }] : [];
}

/**
 * Longueur d'un segment d'après les PK, quand les deux points partagent une
 * ligne. Le changement de ligne d'une bifurcation (slot 2 → ligne du point
 * suivant) prime : sur la ligne d'origine, les PK ne décrivent pas le trajet.
 * @returns {{ meters:number, lineCode:string, isLineChange:boolean }|null}
 */
export function pkSegmentLength(pointA, pointB, voie = 1) {
    const a = pkEntries(pointA, voie);
    const b = pkEntries(pointB, voie);
    const match = (slotA, slotB) => {
        for (const left of a.filter(entry => slotA === null || entry.slot === slotA)) {
            const right = b.find(entry => entry.code === left.code && (slotB === null || entry.slot === slotB));
            if (right) {
                return {
                    meters: Math.abs(right.pk - left.pk),
                    lineCode: left.code,
                    isLineChange: left.slot !== right.slot
                };
            }
        }
        return null;
    };
    return match(2, 1) || match(1, 1) || match(null, null);
}

/** Statut de plausibilité d'une vitesse moyenne. */
export function classifySpeed(speedKmh, durationS, bounds = ROUTE_SPEED_BOUNDS_KMH) {
    if (!(durationS > 0)) return 'no-duration';
    if (speedKmh > bounds.max) return 'too-fast';
    if (speedKmh < bounds.min) return 'too-slow';
    return 'ok';
}

/**
 * Segments d'un trajet dans son ordre de stockage.
 * @param {object} points - dictionnaire global des points (schéma v3)
 * @param {object} route - trajet { id, voie, points: [{ id, durationToNext }] }
 * @returns {Array<object>} un élément par segment, positions cumulées comprises
 */
export function buildRouteSegments(points, route, bounds = ROUTE_SPEED_BOUNDS_KMH) {
    const voie = route?.voie === 2 ? 2 : 1;
    const sequence = route?.points || [];
    const segments = [];
    let startKm = 0;
    let startS = 0;
    for (let index = 0; index < sequence.length - 1; index++) {
        const fromId = sequence[index].id;
        const toId = sequence[index + 1].id;
        const from = points[fromId];
        const to = points[toId];
        const a = routePointCoordinates(from, voie);
        const b = routePointCoordinates(to, voie);
        const distanceKm = haversineDistance(a.lat, a.lon, b.lat, b.lon);
        const pk = pkSegmentLength(from, to, voie);
        const durationS = Number(sequence[index].durationToNext) || 0;
        const speedKmh = durationS > 0 ? distanceKm / durationS * 3600 : null;
        segments.push({
            index,
            fromId,
            toId,
            fromName: from?.name || fromId,
            toName: to?.name || toId,
            fromType: from?.type || 'passage',
            toType: to?.type || 'passage',
            durationS,
            distanceKm,
            pkDistanceKm: pk ? pk.meters / 1000 : null,
            pkLineCode: pk?.lineCode ?? null,
            pkLineChange: pk?.isLineChange ?? false,
            speedKmh,
            pkSpeedKmh: pk && durationS > 0 ? pk.meters / 1000 / durationS * 3600 : null,
            startKm,
            endKm: startKm + distanceKm,
            startS,
            endS: startS + durationS,
            status: classifySpeed(speedKmh, durationS, bounds)
        });
        startKm += distanceKm;
        startS += durationS;
    }
    return segments;
}

/** Totaux d'une liste de segments (durée, distance, vitesse moyenne, anomalies). */
export function summarizeRouteSegments(segments) {
    const totalKm = segments.reduce((sum, segment) => sum + segment.distanceKm, 0);
    const totalS = segments.reduce((sum, segment) => sum + segment.durationS, 0);
    const anomalies = segments.filter(segment => segment.status !== 'ok');
    const speeds = segments.map(segment => segment.speedKmh).filter(Number.isFinite);
    return {
        totalKm,
        totalS,
        averageKmh: totalS > 0 ? totalKm / totalS * 3600 : null,
        maxKmh: speeds.length ? Math.max(...speeds) : null,
        minKmh: speeds.length ? Math.min(...speeds) : null,
        anomalies
    };
}

/**
 * Durée « m:ss » ou secondes brutes vers secondes entières. Accepte aussi
 * « 4 min 05 » et « 245 s », formes courantes à la recopie d'un horaire.
 * @returns {number|null} null si la saisie n'est pas une durée positive
 */
export function parseDurationInput(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return null;
    const clock = text.match(/^(\d+)\s*(?::|min|m)\s*(\d{1,2})?\s*(?:s)?$/);
    if (clock) {
        const seconds = Number(clock[2] || 0);
        return seconds < 60 ? Number(clock[1]) * 60 + seconds : null;
    }
    const plain = text.match(/^(\d+(?:[.,]\d+)?)\s*s?$/);
    if (!plain) return null;
    return Math.round(Number(plain[1].replace(',', '.')));
}

/** Secondes vers « m:ss » (« h:mm:ss » au-delà d'une heure). */
export function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
