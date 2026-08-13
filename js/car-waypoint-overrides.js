// Corrections locales des repères routiers. La configuration versionnée reste
// la source de vérité ; l'éditeur cartographique produit une surcouche explicite,
// partageable par export JSON et appliquée au chargement du mode voiture.

export const CAR_WAYPOINT_OVERRIDES_STORAGE_KEY = 'tallon.carWaypointOverrides.v2';

function waypointBaseKey(leg, point) {
    if (leg?.type === 'pk-corridor') {
        return `corridor:${leg.datasetId || leg.label || 'route'}:${point?.name || 'sans-nom'}`;
    }
    return `point:${point?.id || point?.name || 'sans-id'}`;
}

export function waypointOverrideKey(leg, point) {
    const base = waypointBaseKey(leg, point);
    return leg?.type === 'pk-corridor'
        ? `${base}:${leg.reverse ? 'reverse' : 'forward'}`
        : base;
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

/**
 * Les exports v1 ne distinguaient pas les chaussées. Lors d'un import, leur
 * sens est déduit de l'itinéraire actuellement sélectionné dans l'éditeur.
 */
export function migrateCarWaypointOverrides(value, routeCfg) {
    const normalized = normalizeCarWaypointOverrides(value);
    if (Number(value?.version) >= 2) return normalized;

    const migrated = {};
    for (const [key, correction] of Object.entries(normalized)) {
        if (!key.startsWith('corridor:') || /:(forward|reverse)$/.test(key)) {
            migrated[key] = correction;
            continue;
        }
        const datasetId = key.split(':')[1];
        const leg = routeCfg?.legs?.find(item => item.type === 'pk-corridor' && item.datasetId === datasetId);
        migrated[`${key}:${leg?.reverse ? 'reverse' : 'forward'}`] = correction;
    }
    return migrated;
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
        version: 2,
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
                        if (!correction) return { ...wp };
                        const corrected = { ...wp };
                        if (Number.isFinite(correction.pk)) {
                            if (leg.reverse) corrected.reversePk = correction.pk;
                            else corrected.pk = correction.pk;
                        }
                        if (Number.isFinite(correction.lat) && Number.isFinite(correction.lon)) {
                            if (leg.reverse) {
                                corrected.reverseLat = correction.lat;
                                corrected.reverseLon = correction.lon;
                            } else {
                                corrected.lat = correction.lat;
                                corrected.lon = correction.lon;
                            }
                        }
                        return corrected;
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
