export function getTrainPointCoordinates(point, voie) {
    if (point?.type === 'bifurcation') {
        const lat = point[`lat_V${voie}`];
        const lon = point[`lon_V${voie}`];
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { lat, lon, dedicatedToVoie: true };
        }
    }
    return { lat: point?.lat, lon: point?.lon, dedicatedToVoie: false };
}

export function setTrainPointCoordinates(point, voie, lat, lon) {
    if (!point || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Coordonnées invalides.');
    }
    if (point.type === 'bifurcation') {
        point[`lat_V${voie}`] = lat;
        point[`lon_V${voie}`] = lon;
    } else {
        point.lat = lat;
        point.lon = lon;
    }
    return point;
}

export function resetTrainPointCoordinates(point, originalPoint, voie) {
    if (point?.type === 'bifurcation') {
        for (const axis of ['lat', 'lon']) {
            const field = `${axis}_V${voie}`;
            if (Object.hasOwn(originalPoint || {}, field)) point[field] = originalPoint[field];
            else delete point[field];
        }
        return;
    }
    point.lat = originalPoint.lat;
    point.lon = originalPoint.lon;
}
