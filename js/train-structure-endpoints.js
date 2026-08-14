import { parseCsv, applyDescriptor } from './csv.js';
import { buildCorridor } from './linearref.js';
import { buildSegmentCandidate } from './functions.js';
import { haversineDistance } from './geo.js';

export function structureLengthMeters(point) {
    const explicitLength = Number(point?.longueur);
    if (Number.isFinite(explicitLength) && explicitLength > 0) return explicitLength;

    const match = String(point?.name || '').match(/\(([\d\s.,]+)\s*m\)/i);
    if (!match) return null;
    const parsed = Number(match[1].replace(/[\s.]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nearestCorridorLocation(corridor, lat, lon) {
    let best = null;
    for (let index = 0; index < corridor.points.length - 1; index++) {
        const start = corridor.points[index];
        const end = corridor.points[index + 1];
        const candidate = buildSegmentCandidate(start, end, lat, lon);
        if (!candidate || (best && candidate.offsetKm >= best.offsetKm)) continue;
        best = {
            index,
            ratio: candidate.ratio,
            offsetKm: candidate.offsetKm,
            distanceKm: corridor.cumKm[index] + candidate.distanceFromSegmentStart,
            lat: start.lat + candidate.ratio * (end.lat - start.lat),
            lon: start.lon + candidate.ratio * (end.lon - start.lon)
        };
    }
    return best;
}

export function snapToRailCorridor(corridor, lat, lon) {
    const location = corridor ? nearestCorridorLocation(corridor, lat, lon) : null;
    return location ? { lat: location.lat, lon: location.lon, offsetKm: location.offsetKm } : null;
}

function coordinateAtDistance(corridor, distanceKm) {
    const target = Math.max(0, Math.min(corridor.totalKm, distanceKm));
    let low = 0;
    let high = corridor.cumKm.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (corridor.cumKm[middle] < target) low = middle + 1;
        else high = middle;
    }
    const endIndex = Math.max(1, low);
    const startIndex = endIndex - 1;
    const segmentKm = corridor.cumKm[endIndex] - corridor.cumKm[startIndex];
    const ratio = segmentKm > 0
        ? (target - corridor.cumKm[startIndex]) / segmentKm
        : 0;
    const start = corridor.points[startIndex];
    const end = corridor.points[endIndex];
    return {
        lat: start.lat + ratio * (end.lat - start.lat),
        lon: start.lon + ratio * (end.lon - start.lon),
        distanceKm: target,
        segmentIndex: startIndex
    };
}

function pathBetweenLocations(corridor, startLocation, endLocation, exactStart, exactEnd) {
    const forward = endLocation.distanceKm >= startLocation.distanceKm;
    const path = [exactStart, { lat: startLocation.lat, lon: startLocation.lon }];
    if (forward) {
        for (let index = startLocation.index + 1; index <= endLocation.index; index++) {
            const distance = corridor.cumKm[index];
            if (distance > startLocation.distanceKm && distance < endLocation.distanceKm) {
                path.push(corridor.points[index]);
            }
        }
    } else {
        for (let index = startLocation.index; index > endLocation.index; index--) {
            const distance = corridor.cumKm[index];
            if (distance < startLocation.distanceKm && distance > endLocation.distanceKm) {
                path.push(corridor.points[index]);
            }
        }
    }
    path.push({ lat: endLocation.lat, lon: endLocation.lon }, exactEnd);
    return path.filter((point, index, points) => {
        const previous = points[index - 1];
        return !previous || previous.lat !== point.lat || previous.lon !== point.lon;
    });
}

export function projectStructureEndpoint(point, corridor) {
    // Les corridors sont ordonnés par PK croissant, qui correspond au sens V1.
    // L'entrée V2 se trouve donc à longueur mètres en aval de l'entrée V1.
    const lengthM = structureLengthMeters(point);
    if (!corridor || !lengthM || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
    const start = nearestCorridorLocation(corridor, point.lat_V1 ?? point.lat, point.lon_V1 ?? point.lon);
    if (!start) return null;
    const end = coordinateAtDistance(corridor, start.distanceKm + lengthM / 1000);
    return {
        lengthM,
        lat: end.lat,
        lon: end.lon,
        startOffsetKm: start.offsetKm,
        path: pathBetweenLocations(
            corridor,
            start,
            { ...end, index: end.segmentIndex },
            { lat: point.lat_V1 ?? point.lat, lon: point.lon_V1 ?? point.lon },
            { lat: end.lat, lon: end.lon }
        )
    };
}

export function structurePathOnCorridor(point, corridor) {
    if (!corridor) return null;
    const startCoordinates = {
        lat: point.lat_V1 ?? point.lat,
        lon: point.lon_V1 ?? point.lon
    };
    const endCoordinates = {
        lat: point.lat_V2 ?? point.lat,
        lon: point.lon_V2 ?? point.lon
    };
    const start = nearestCorridorLocation(corridor, startCoordinates.lat, startCoordinates.lon);
    const end = nearestCorridorLocation(corridor, endCoordinates.lat, endCoordinates.lon);
    if (!start || !end) return null;
    return pathBetweenLocations(corridor, start, end, startCoordinates, endCoordinates);
}

function corridorForStructure(point, corridorsByLine) {
    const declared = corridorsByLine.get(String(point.code_ligne || ''));
    if (declared) return declared;
    let best = null;
    for (const corridor of corridorsByLine.values()) {
        const location = nearestCorridorLocation(corridor, point.lat_V1 ?? point.lat, point.lon_V1 ?? point.lon);
        if (location && (!best || location.offsetKm < best.offsetKm)) {
            best = { corridor, offsetKm: location.offsetKm };
        }
    }
    return best?.corridor || null;
}

export function applyStructureEndpointSuggestions(points, corridorsByLine) {
    const suggestions = new Map();
    for (const [pointId, point] of Object.entries(points || {})) {
        if (point?.type !== 'ouvrage_art') continue;
        if (!Number.isFinite(point.lat_V1) || !Number.isFinite(point.lon_V1)) {
            point.lat_V1 = point.lat;
            point.lon_V1 = point.lon;
        }
        const lengthM = structureLengthMeters(point);
        if (lengthM && !(Number.isFinite(point.longueur) && point.longueur > 0)) point.longueur = lengthM;
        if (Number.isFinite(point.lat_V2) && Number.isFinite(point.lon_V2)) continue;
        const corridor = corridorForStructure(point, corridorsByLine);
        const suggestion = projectStructureEndpoint(point, corridor);
        if (!suggestion) continue;
        point.lat_V2 = Number(suggestion.lat.toFixed(7));
        point.lon_V2 = Number(suggestion.lon.toFixed(7));
        suggestions.set(pointId, suggestion);
    }
    return suggestions;
}

export function validateStructureEndpoints(points, minDistanceM) {
    if (!Number.isFinite(minDistanceM) || minDistanceM < 0) {
        throw new Error('Distance minimale de validation invalide.');
    }
    const errors = [];
    for (const [pointId, point] of Object.entries(points || {})) {
        if (point?.type !== 'ouvrage_art') continue;
        const hasVoie1 = Number.isFinite(point.lat_V1) && Number.isFinite(point.lon_V1);
        const hasVoie2 = Number.isFinite(point.lat_V2) && Number.isFinite(point.lon_V2);
        if (!hasVoie1 || !hasVoie2) {
            errors.push(`${point.name || pointId} : les entrées V1 et V2 doivent être positionnées.`);
            continue;
        }
        const distanceM = haversineDistance(point.lat_V1, point.lon_V1, point.lat_V2, point.lon_V2) * 1000;
        if (distanceM < minDistanceM) {
            errors.push(`${point.name || pointId} : les entrées V1 et V2 doivent être distinctes.`);
        }
    }
    return { valid: errors.length === 0, errors };
}

export async function loadRailCorridors(descriptorUrl, fetchImpl = globalThis.fetch) {
    const descriptorResponse = await fetchImpl(descriptorUrl);
    if (!descriptorResponse.ok) throw new Error(`Descripteur ferroviaire introuvable (HTTP ${descriptorResponse.status}).`);
    const descriptor = await descriptorResponse.json();
    const csvResponse = await fetchImpl(descriptor.file);
    if (!csvResponse.ok) throw new Error(`Polyline ferroviaire introuvable (HTTP ${csvResponse.status}).`);
    const rows = parseCsv(await csvResponse.text(), descriptor.csv || {});
    const lineColumn = descriptor.columns?.line;
    const lineCodes = new Set(rows.map(row => String(row[lineColumn] || '').trim()).filter(Boolean));
    const corridors = new Map();
    for (const lineCode of lineCodes) {
        const filters = [
            ...(descriptor.filters || []).filter(filter => filter.column !== lineColumn),
            { column: lineColumn, equals: lineCode }
        ];
        const points = applyDescriptor(rows, { ...descriptor, filters });
        if (points.length >= 2) corridors.set(lineCode, buildCorridor(points));
    }
    return corridors;
}
