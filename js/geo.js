// js/geo.js

/**
 * Distance Haversine entre deux points (en km)
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
    if (typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
        typeof lat2 !== 'number' || typeof lon2 !== 'number') {
        return 0;
    }
    
    const R = 6371; // km
    const toRad = (deg) => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Distances cumulées (km) le long d'une polyligne, depuis son premier point.
 * Le tableau retourné a la même longueur que `points` (index i = distance
 * parcourue jusqu'au point i), ce qui permet de situer n'importe quel point
 * dans le référentiel du trajet plutôt qu'à vol d'oiseau.
 * @param {Array<{lat:number, lon:number}>} points
 * @returns {number[]}
 */
export function buildCumulativeDistances(points) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const cumKm = [0];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        cumKm.push(cumKm[i - 1] + haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon));
    }
    return cumKm;
}

/**
 * Calcule la progression sur un segment donné.
 */
export function computeSegmentProgress(route, segIdx, lat, lon) {
    if (!route || segIdx < 0 || segIdx >= route.length - 1) {
        return { distanceFromStart: 0, segmentLength: 0 };
    }

    const pStart = route[segIdx];
    const pEnd = route[segIdx + 1];

    if (
        typeof pStart.lat !== 'number' || typeof pStart.lon !== 'number' ||
        typeof pEnd.lat !== 'number' || typeof pEnd.lon !== 'number'
    ) {
        return { distanceFromStart: 0, segmentLength: 0 };
    }

    // Utiliser segmentLengthToNext du point enrichi (déjà recalculé dans buildEffectiveRoute)
    let segmentLength = Number(pStart.segmentLengthToNext || 0);
    if (!segmentLength || segmentLength <= 0) {
        segmentLength = haversineDistance(pStart.lat, pStart.lon, pEnd.lat, pEnd.lon);
    }

    const distanceFromStart = haversineDistance(pStart.lat, pStart.lon, lat, lon);
    const clampedDistance = Math.max(0, Math.min(distanceFromStart, segmentLength));

    return {
        distanceFromStart: clampedDistance,
        segmentLength
    };
}

/**
 * Message d'erreur pour les erreurs de géolocalisation
 */
export function geoErrorMessage(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            return "L'utilisateur a refusé la demande de géolocalisation.";
        case error.POSITION_UNAVAILABLE:
            return "Les informations de localisation ne sont pas disponibles.";
        case error.TIMEOUT:
            return "La demande de géolocalisation a expiré.";
        default:
            return "Une erreur inconnue s'est produite.";
    }
}
