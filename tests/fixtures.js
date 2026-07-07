// tests/fixtures.js
// Routes et positions GPS simulées pour tester les cas limites hors conditions
// réelles. La route synthétique descend plein sud (type LGV Sud-Est) avec des
// points espacés de quelques km.

import { haversineDistance } from '../js/geo.js';

/**
 * Construit une route "effective" enrichie (même forme que la sortie de
 * buildEffectiveRoute) à partir d'une liste de points bruts.
 * @param {Array<{id:string, name?:string, lat:number, lon:number, durationToNext?:number, isStop?:boolean}>} rawPoints
 */
export function makeEffectiveRoute(rawPoints) {
    const n = rawPoints.length;
    return rawPoints.map((p, i) => {
        const next = rawPoints[i + 1];
        const segLen = next ? haversineDistance(p.lat, p.lon, next.lat, next.lon) : 0;
        return {
            id: p.id,
            name: p.name || p.id,
            lat: p.lat,
            lon: p.lon,
            baseDuration: p.durationToNext || 0,
            durationEffective: p.durationToNext || 0,
            isStop: !!p.isStop,
            isAccelerating: !!p.isStop,
            isDecelerating: i < n - 1 && !!rawPoints[i + 1].isStop,
            segmentLengthToNext: segLen
        };
    });
}

/**
 * Route sud (type Paris → Lyon raccourcie) : ~40 km, 9 points.
 * Chaque segment fait ~5 km et dure 120 s (~150 km/h de moyenne).
 */
export function southboundRoute() {
    return makeEffectiveRoute([
        { id: 'P0', name: 'Départ',   lat: 48.8443, lon: 2.3756, durationToNext: 120, isStop: true },
        { id: 'P1', name: 'Bif A',    lat: 48.7999, lon: 2.4100, durationToNext: 120 },
        { id: 'P2', name: 'Tunnel',   lat: 48.7550, lon: 2.4450, durationToNext: 120 },
        { id: 'P3', name: 'Plaine',   lat: 48.7100, lon: 2.4800, durationToNext: 120 },
        { id: 'P4', name: 'Gare TGV', lat: 48.6650, lon: 2.5150, durationToNext: 120, isStop: true },
        { id: 'P5', name: 'Viaduc',   lat: 48.6200, lon: 2.5500, durationToNext: 120 },
        { id: 'P6', name: 'Bif B',    lat: 48.5750, lon: 2.5850, durationToNext: 120 },
        { id: 'P7', name: 'Entrée',   lat: 48.5300, lon: 2.6200, durationToNext: 120 },
        { id: 'P8', name: 'Terminus', lat: 48.4850, lon: 2.6550, durationToNext: 0, isStop: true }
    ]);
}

/** Route nord : la même, inversée (sens province → Paris). */
export function northboundRoute() {
    const pts = southboundRoute().slice().reverse();
    return makeEffectiveRoute(pts.map(p => ({
        id: p.id, name: p.name, lat: p.lat, lon: p.lon, durationToNext: 120, isStop: p.isStop
    })));
}

/**
 * Position GPS simulée sur un segment de la route.
 * @param {Array} route
 * @param {number} segIdx
 * @param {number} t - progression 0..1 sur le segment
 * @param {number} [latOffsetDeg] - décalage latéral en degrés (bruit GPS)
 */
export function positionOnSegment(route, segIdx, t, latOffsetDeg = 0) {
    const a = route[segIdx];
    const b = route[segIdx + 1];
    return {
        lat: a.lat + (b.lat - a.lat) * t + latOffsetDeg,
        lon: a.lon + (b.lon - a.lon) * t
    };
}

/** Décalage latéral en degrés de latitude correspondant à `meters` mètres. */
export function metersToLatDeg(meters) {
    return meters / 111_320;
}

/** Décalage en degrés de longitude correspondant à `meters` mètres à la latitude donnée. */
export function metersToLonDeg(meters, lat) {
    return meters / (111_320 * Math.cos(lat * Math.PI / 180));
}
