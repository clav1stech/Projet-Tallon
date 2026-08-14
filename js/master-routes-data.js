export const MASTER_ROUTES_URL = 'data/masterRoutes.normalized.json';

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidCoordinate(lat, lon) {
    return Number.isFinite(lat)
        && Number.isFinite(lon)
        && lat >= -90 && lat <= 90
        && lon >= -180 && lon <= 180;
}

/**
 * Valide les invariants nécessaires aux consommateurs du schéma v3.
 * Les coordonnées par voie restent optionnelles pour les points directionnels
 * historiques, mais doivent toujours être fournies par paire.
 */
export function validateMasterRoutes(data) {
    const errors = [];
    if (!isObject(data)) return { valid: false, errors: ['La racine doit être un objet JSON.'] };
    if (data._schema !== 'v3') errors.push('Le champ _schema doit valoir "v3".');
    if (!isObject(data.points)) errors.push('Le champ points doit être un dictionnaire.');
    if (!Array.isArray(data.trajets)) errors.push('Le champ trajets doit être un tableau.');
    if (errors.length) return { valid: false, errors };

    for (const [pointId, point] of Object.entries(data.points)) {
        const prefix = `Point ${pointId}`;
        if (!pointId || !isObject(point)) {
            errors.push(`${prefix} doit être un objet.`);
            continue;
        }
        if (typeof point.name !== 'string' || !point.name.trim()) {
            errors.push(`${prefix} doit avoir un nom.`);
        }
        if (!isValidCoordinate(point.lat, point.lon)) {
            errors.push(`${prefix} a des coordonnées lat/lon invalides.`);
        }
        for (const voie of [1, 2]) {
            const lat = point[`lat_V${voie}`];
            const lon = point[`lon_V${voie}`];
            const hasLat = lat !== undefined && lat !== null;
            const hasLon = lon !== undefined && lon !== null;
            if (hasLat !== hasLon || (hasLat && !isValidCoordinate(lat, lon))) {
                errors.push(`${prefix} a des coordonnées V${voie} invalides ou incomplètes.`);
            }
        }
    }

    const routeIds = new Set();
    for (const [routeIndex, route] of data.trajets.entries()) {
        const prefix = `Trajet ${route?.id || `#${routeIndex + 1}`}`;
        if (!isObject(route)) {
            errors.push(`${prefix} doit être un objet.`);
            continue;
        }
        if (typeof route.id !== 'string' || !route.id.trim()) {
            errors.push(`${prefix} doit avoir un identifiant.`);
        } else if (routeIds.has(route.id)) {
            errors.push(`L’identifiant de trajet ${route.id} est dupliqué.`);
        } else {
            routeIds.add(route.id);
        }
        if (route.voie !== 1 && route.voie !== 2) {
            errors.push(`${prefix} doit déclarer voie = 1 ou voie = 2.`);
        }
        if (!Array.isArray(route.points) || route.points.length < 2) {
            errors.push(`${prefix} doit référencer au moins deux points.`);
            continue;
        }
        route.points.forEach((routePoint, pointIndex) => {
            if (!isObject(routePoint) || typeof routePoint.id !== 'string' || !data.points[routePoint.id]) {
                errors.push(`${prefix}, position ${pointIndex + 1} : référence de point inconnue.`);
                return;
            }
            if (pointIndex < route.points.length - 1
                && (!Number.isFinite(routePoint.durationToNext) || routePoint.durationToNext < 0)) {
                errors.push(`${prefix}, point ${routePoint.id} : durationToNext doit être un nombre positif ou nul.`);
            }
        });
    }

    return { valid: errors.length === 0, errors };
}

export function buildMasterRoutesDocument(points, trajets) {
    const data = { _schema: 'v3', points, trajets };
    const validation = validateMasterRoutes(data);
    if (!validation.valid) {
        const error = new Error(`Export refusé : ${validation.errors.join(' ')}`);
        error.validationErrors = validation.errors;
        throw error;
    }
    return data;
}

export async function loadMasterRoutes(fetchImpl = globalThis.fetch, url = MASTER_ROUTES_URL) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const validation = validateMasterRoutes(data);
    if (!validation.valid) {
        throw new Error(`Données master routes invalides : ${validation.errors.join(' ')}`);
    }
    return data;
}

export function downloadMasterRoutesDocument(data) {
    const validation = validateMasterRoutes(data);
    if (!validation.valid) {
        throw new Error(`Export refusé : ${validation.errors.join(' ')}`);
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'masterRoutes.normalized.json';
    anchor.click();
    URL.revokeObjectURL(url);
}
