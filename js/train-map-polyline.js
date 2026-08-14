import { getTrainPointCoordinates } from './train-points-model.js';
import { pathBetweenRailCoordinates, snapToRailCorridor } from './train-structure-endpoints.js';

function pointLineCodes(point) {
    return [...new Set([point?.code_ligne, point?.code_ligne_2]
        .map(value => String(value || '').trim())
        .filter(Boolean))];
}

function corridorScore(corridor, start, end) {
    const snappedStart = snapToRailCorridor(corridor, start.lat, start.lon);
    const snappedEnd = snapToRailCorridor(corridor, end.lat, end.lon);
    if (!snappedStart || !snappedEnd) return Infinity;
    return snappedStart.offsetKm + snappedEnd.offsetKm;
}

function selectSegmentCorridor(startPoint, endPoint, start, end, corridorsByLine) {
    const startLines = new Set(pointLineCodes(startPoint));
    const sharedLines = pointLineCodes(endPoint).filter(line => startLines.has(line));
    const candidateLines = sharedLines.filter(line => corridorsByLine.has(line));
    const candidates = candidateLines.map(line => corridorsByLine.get(line));

    let best = null;
    for (const corridor of candidates) {
        const score = corridorScore(corridor, start, end);
        if (!best || score < best.score) best = { corridor, score };
    }
    return Number.isFinite(best?.score) ? best.corridor : null;
}

function appendPath(target, path) {
    for (const point of path || []) {
        const previous = target[target.length - 1];
        if (!previous || previous.lat !== point.lat || previous.lon !== point.lon) target.push(point);
    }
}

/**
 * Reconstruit le tracé cartographique d'un trajet sur les polylines SNCF.
 * Les métadonnées de ligne choisissent le corridor à chaque segment ; aux
 * bifurcations, la ligne commune avec le point suivant assure la transition.
 */
export function buildTrainRoutePolyline(points, route, voie, corridorsByLine) {
    const path = [];
    const routePoints = route?.points || [];
    for (let index = 0; index < routePoints.length - 1; index++) {
        const startPoint = points[routePoints[index].id];
        const endPoint = points[routePoints[index + 1].id];
        if (!startPoint || !endPoint) continue;
        const start = getTrainPointCoordinates(startPoint, voie);
        const end = getTrainPointCoordinates(endPoint, voie);
        const corridor = selectSegmentCorridor(startPoint, endPoint, start, end, corridorsByLine);
        const segmentPath = pathBetweenRailCoordinates(corridor, start, end, { includeExactEndpoints: false })
            || [{ lat: start.lat, lon: start.lon }, { lat: end.lat, lon: end.lon }];
        appendPath(path, segmentPath);
    }
    return path;
}
