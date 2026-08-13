// Corrections locales des repères routiers. La configuration versionnée reste
// la source de vérité ; l'éditeur cartographique produit une surcouche explicite,
// partageable par export JSON et appliquée au chargement du mode voiture.

export const CAR_WAYPOINT_OVERRIDES_STORAGE_KEY = 'tallon.carWaypointOverrides.v1';

export function waypointOverrideKey(leg, point) {
    if (leg?.type === 'pk-corridor') {
        return `corridor:${leg.datasetId || leg.label || 'route'}:${point?.name || 'sans-nom'}`;
    }
    return `point:${point?.id || point?.name || 'sans-id'}`;
}

export function normalizeCarWaypointOverrides(value) {
    const raw = value?.overrides && typeof value.overrides === 'object'
        ? value.overrides
        : value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const normalized = {};
    for (const [key, correction] of Object.entries(raw)) {
        if (!correction || typeof correction !== 'object') continue;
        const clean = {};
        if (Number.isFinite(Number(correction.pk))) clean.pk = Number(correction.pk);
        if (Number.isFinite(Number(correction.lat)) && Number.isFinite(Number(correction.lon))) {
            clean.lat = Number(correction.lat);
            clean.lon = Number(correction.lon);
        }
        if (Object.keys(clean).length) normalized[key] = clean;
    }
    return normalized;
}

export function loadCarWaypointOverrides(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(CAR_WAYPOINT_OVERRIDES_STORAGE_KEY);
        return raw ? normalizeCarWaypointOverrides(JSON.parse(raw)) : {};
    } catch (error) {
        console.warn('Corrections cartographiques voiture illisibles :', error);
        return {};
    }
}

export function saveCarWaypointOverrides(overrides, storage = globalThis.localStorage) {
    const normalized = normalizeCarWaypointOverrides(overrides);
    storage?.setItem(CAR_WAYPOINT_OVERRIDES_STORAGE_KEY, JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        overrides: normalized
    }));
    return normalized;
}

export function applyCarWaypointOverrides(routeCfg, overrides) {
    const normalized = normalizeCarWaypointOverrides(overrides);
    if (!routeCfg || !Array.isArray(routeCfg.legs)) return routeCfg;

    return {
        ...routeCfg,
        legs: routeCfg.legs.map(leg => {
            if (leg.type === 'pk-corridor') {
                return {
                    ...leg,
                    waypoints: (leg.waypoints || []).map(wp => {
                        const correction = normalized[waypointOverrideKey(leg, wp)];
                        return correction && Number.isFinite(correction.pk)
                            ? { ...wp, pk: correction.pk }
                            : { ...wp };
                    })
                };
            }
            if (leg.type === 'points') {
                return {
                    ...leg,
                    points: (leg.points || []).map(point => {
                        const correction = normalized[waypointOverrideKey(leg, point)];
                        return correction && Number.isFinite(correction.lat) && Number.isFinite(correction.lon)
                            ? { ...point, lat: correction.lat, lon: correction.lon }
                            : { ...point };
                    })
                };
            }
            return { ...leg };
        })
    };
}
