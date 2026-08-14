// js/car-route.js
// Construction de la route voiture hybride (corridor PK + waypoints manuels)
// et calcul des distances. Logique PURE (pas de DOM, pas de fetch) → testable Vitest.
//
// Principe : les legs hétérogènes sont aplatis en UN SEUL tableau de points
// {lat, lon, pk?, name?, legIndex} — le matching réutilise ensuite les
// fonctions existantes du rail (findNearestSegmentIndex,
// computeSegmentIndexAndDistance, projectPositionOnRouteSegment) sur ce
// tableau, avec le fallback latitude désactivé (itinéraire ouest-est) :
// en cas d'échec du matching, le repli est purement séquentiel (on reste sur
// le dernier index validé), aucune logique cardinale.

import { haversineDistance } from './geo.js';
import { buildCorridor } from './linearref.js';
import { waypointOverrideKey } from './car-waypoint-overrides.js';

// Vitesses indicatives par type de leg si `avgSpeedKmh` absent de la config.
export const DEFAULT_LEG_SPEED_KMH = {
    'pk-corridor': 110, // autoroute
    'points': 50        // route
};

/**
 * Aplati les legs d'un itinéraire voiture en une route unique.
 * @param {object} routeCfg - une entrée de CAR_ROUTES
 * @param {Object<string, {points: Array}>} datasetsById - datasets chargés,
 *        indexés par id de descripteur (sortie de csv.js loadDataset)
 * @returns {{ points: Array, cumKm: number[], totalKm: number,
 *             legs: Array<{index:number, type:string, label:string, startIdx:number, endIdx:number, startKm:number, endKm:number}>,
 *             waypoints: Array<{name:string, type:string, routeKm:number, legIndex:number, pk?:number, km?:number, lengthM?:number}> }}
 *   Chaque point porte : lat, lon, legIndex, legLabel, et selon le leg :
 *   pk + line (corridor) ou id + name (waypoints). `durationEffective`
 *   (secondes vers le point suivant) est calculée depuis avgSpeedKmh pour
 *   alimenter la simulation fakeGeoSim.
 */
export function buildCarRoute(routeCfg, datasetsById = {}) {
    if (!routeCfg || !Array.isArray(routeCfg.legs) || routeCfg.legs.length === 0) {
        throw new Error('buildCarRoute : configuration d\'itinéraire invalide (legs manquants)');
    }

    const points = [];
    const legBounds = []; // { legIndex, startIdx } — endIdx résolu après coup

    routeCfg.legs.forEach((leg, legIndex) => {
        let legPoints = [];

        if (leg.type === 'pk-corridor') {
            const ds = datasetsById[leg.datasetId];
            if (!ds || !Array.isArray(ds.points)) {
                throw new Error(`buildCarRoute : dataset "${leg.datasetId}" manquant pour le leg "${leg.label ?? legIndex}"`);
            }
            const corridor = buildCorridor(ds.points);
            legPoints = corridor.points.map(p => ({ lat: p.lat, lon: p.lon, pk: p.pk, line: p.line ?? null }));
            // pkRange: [min, max] — ne garder qu'une portion du corridor.
            // Nécessaire quand le trajet quitte la route avant sa fin (sortie
            // Sallanches sur l'A40) ou la rejoint en cours (jonction A406→A40).
            if (Array.isArray(leg.pkRange) && leg.pkRange.length === 2) {
                const [pkMin, pkMax] = leg.pkRange;
                legPoints = legPoints.filter(p =>
                    (!Number.isFinite(pkMin) || p.pk >= pkMin) &&
                    (!Number.isFinite(pkMax) || p.pk <= pkMax)
                );
            }
        } else if (leg.type === 'points') {
            legPoints = (leg.points || [])
                .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
                .map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }));
        } else {
            throw new Error(`buildCarRoute : type de leg inconnu "${leg.type}"`);
        }

        // `reverse: true` — leg parcouru à rebours de son référentiel source
        // (trajet retour sur un corridor tracé dans le sens aller). Les pk
        // restent ceux du référentiel d'origine, seul l'ordre de parcours
        // change ; le matching séquentiel reste monotone par construction.
        if (leg.reverse) legPoints.reverse();

        if (legPoints.length === 0) return;

        legBounds.push({ legIndex, startIdx: points.length > 0 ? points.length : 0 });
        for (const p of legPoints) {
            const prev = points[points.length - 1];
            // Jonction entre legs : ignorer un point confondu avec le précédent
            if (prev && haversineDistance(prev.lat, prev.lon, p.lat, p.lon) < 0.001) continue;
            points.push({ ...p, legIndex, legLabel: leg.label ?? '' });
        }
    });

    if (points.length < 2) {
        throw new Error('buildCarRoute : moins de 2 points exploitables');
    }

    // Distances cumulées + durées indicatives par segment
    const cumKm = [0];
    for (let i = 1; i < points.length; i++) {
        cumKm.push(cumKm[i - 1] + haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon));
    }
    for (let i = 0; i < points.length - 1; i++) {
        const leg = routeCfg.legs[points[i].legIndex];
        const speed = Number(leg?.avgSpeedKmh) || DEFAULT_LEG_SPEED_KMH[leg?.type] || 60;
        const segKm = cumKm[i + 1] - cumKm[i];
        points[i].durationEffective = (segKm / speed) * 3600;
    }
    points[points.length - 1].durationEffective = 0;

    // Métadonnées de legs (bornes d'index et de km) pour l'affichage
    const legs = routeCfg.legs.map((leg, legIndex) => {
        let startIdx = -1;
        let endIdx = -1;
        for (let i = 0; i < points.length; i++) {
            if (points[i].legIndex === legIndex) {
                if (startIdx === -1) startIdx = i;
                endIdx = i;
            }
        }
        return {
            index: legIndex,
            type: leg.type,
            label: leg.label ?? '',
            startIdx,
            endIdx,
            startKm: startIdx >= 0 ? cumKm[startIdx] : 0,
            endKm: endIdx >= 0 ? cumKm[endIdx] : 0
        };
    });

    // Points de passage nommés, projetés dans le référentiel km-route :
    // - legs corridor : waypoints déclarés en pk_cum dans la config, interpolés
    //   entre les deux points du corridor qui les bornent (un waypoint hors du
    //   pkRange effectif du leg est ignoré) ;
    // - legs 'points' : chaque point nommé devient un waypoint type 'etape'.
    const waypoints = [];
    for (const legMeta of legs) {
        if (legMeta.startIdx < 0) continue;
        const legCfg = routeCfg.legs[legMeta.index];

        if (legCfg.type === 'pk-corridor' && Array.isArray(legCfg.waypoints)) {
            for (const wp of legCfg.waypoints) {
                if (!wp) continue;
                const waypointPk = legCfg.reverse && Number.isFinite(wp.reversePk)
                    ? wp.reversePk
                    : wp.pk;
                if (!Number.isFinite(waypointPk)) continue;
                for (let i = legMeta.startIdx; i < legMeta.endIdx; i++) {
                    const a = points[i];
                    const b = points[i + 1];
                    if (!Number.isFinite(a.pk) || !Number.isFinite(b.pk)) continue;
                    // Encadrement dans les deux sens : sur un leg `reverse`,
                    // les pk décroissent le long du parcours.
                    if (waypointPk < Math.min(a.pk, b.pk) || waypointPk > Math.max(a.pk, b.pk)) continue;
                    const ratio = b.pk !== a.pk ? (waypointPk - a.pk) / (b.pk - a.pk) : 0;
                    const explicitLat = legCfg.reverse ? wp.reverseLat : wp.lat;
                    const explicitLon = legCfg.reverse ? wp.reverseLon : wp.lon;
                    waypoints.push({
                        name: wp.name,
                        type: wp.type ?? 'sortie',
                        routeKm: cumKm[i] + ratio * (cumKm[i + 1] - cumKm[i]),
                        lat: Number.isFinite(explicitLat) ? explicitLat : a.lat + ratio * (b.lat - a.lat),
                        lon: Number.isFinite(explicitLon) ? explicitLon : a.lon + ratio * (b.lon - a.lon),
                        legIndex: legMeta.index,
                        sourceKey: waypointOverrideKey(legCfg, wp),
                        pk: waypointPk,
                        km: wp.km,
                        lengthM: wp.lengthM
                    });
                    break;
                }
            }
        } else if (legCfg.type === 'points') {
            for (let i = legMeta.startIdx; i <= legMeta.endIdx; i++) {
                if (!points[i].name) continue;
                waypoints.push({
                    name: points[i].name,
                    type: 'etape',
                    routeKm: cumKm[i],
                    lat: points[i].lat,
                    lon: points[i].lon,
                    legIndex: legMeta.index,
                    sourceKey: waypointOverrideKey(legCfg, points[i])
                });
            }
        }
    }
    waypoints.sort((a, b) => a.routeKm - b.routeKm);

    // Départ/arrivée synthétiques (`origin`/`destination` dans la config) :
    // seulement si aucun waypoint n'occupe déjà l'extrémité (ex. un leg
    // 'points' terminal fournit déjà l'étape d'arrivée).
    const totalKm = cumKm[cumKm.length - 1];
    if (routeCfg.origin && !(waypoints.length && waypoints[0].routeKm < 0.2)) {
        waypoints.unshift({
            name: routeCfg.origin,
            type: 'depart',
            routeKm: 0,
            lat: points[0].lat,
            lon: points[0].lon,
            legIndex: points[0].legIndex
        });
    }
    if (routeCfg.destination && !(waypoints.length && totalKm - waypoints[waypoints.length - 1].routeKm < 0.2)) {
        waypoints.push({
            name: routeCfg.destination,
            type: 'arrivee',
            routeKm: totalKm,
            lat: points[points.length - 1].lat,
            lon: points[points.length - 1].lon,
            legIndex: points[points.length - 1].legIndex
        });
    }

    return { points, cumKm, totalKm, legs, waypoints };
}

function interpolateRoutePoint(route, routeKm) {
    const { points, cumKm } = route || {};
    if (!Array.isArray(points) || !Array.isArray(cumKm) || points.length < 2 || points.length !== cumKm.length) {
        return null;
    }

    const clampedKm = Math.max(cumKm[0], Math.min(cumKm[cumKm.length - 1], routeKm));
    for (let i = 0; i < cumKm.length - 1; i++) {
        if (clampedKm > cumKm[i + 1]) continue;
        const spanKm = cumKm[i + 1] - cumKm[i];
        const ratio = spanKm > 0 ? (clampedKm - cumKm[i]) / spanKm : 0;
        return {
            lat: points[i].lat + ratio * (points[i + 1].lat - points[i].lat),
            lon: points[i].lon + ratio * (points[i + 1].lon - points[i].lon),
            routeKm: clampedKm
        };
    }
    const last = points[points.length - 1];
    return { lat: last.lat, lon: last.lon, routeKm: cumKm[cumKm.length - 1] };
}

/**
 * Extrait la portion du tracé correspondant à la longueur d'un ouvrage à
 * partir de son repère d'entrée, dans le sens du trajet construit. Comme les
 * legs retour sont inversés avant le calcul des distances cumulées, avancer
 * dans `routeKm` suit automatiquement le bon sens de circulation.
 * @returns {Array<{lat:number, lon:number, routeKm:number}>}
 */
export function projectRouteLength(route, startRouteKm, lengthM, legIndex = null) {
    if (!route || !Number.isFinite(startRouteKm) || !Number.isFinite(lengthM) || lengthM <= 0) return [];

    const leg = legIndex == null ? null : route.legs?.find(item => item.index === legIndex);
    const minKm = Number.isFinite(leg?.startKm) ? leg.startKm : 0;
    const maxKm = Number.isFinite(leg?.endKm) ? leg.endKm : route.totalKm;
    const startKm = Math.max(minKm, Math.min(maxKm, startRouteKm));
    const endKm = Math.min(maxKm, startKm + lengthM / 1000);
    if (!(endKm > startKm)) return [];

    const start = interpolateRoutePoint(route, startKm);
    const end = interpolateRoutePoint(route, endKm);
    if (!start || !end) return [];

    const projected = [start];
    for (let i = 1; i < route.cumKm.length - 1; i++) {
        if (route.cumKm[i] > startKm && route.cumKm[i] < endKm) {
            projected.push({
                lat: route.points[i].lat,
                lon: route.points[i].lon,
                routeKm: route.cumKm[i]
            });
        }
    }
    projected.push(end);
    return projected;
}

/**
 * Secteur géographique courant, pour l'affichage HUD.
 * Déclaré dans la config des legs, dans le référentiel pk du corridor
 * (indépendant du sens de parcours, donc partageable aller/retour) :
 * - leg corridor : `sectors: [{ name, pkFrom, pkTo }]` ;
 * - tout leg : `sector: 'Nom'` (secteur unique du leg, repli si aucune
 *   plage ne matche).
 * @param {object} routeCfg - une entrée de CAR_ROUTES
 * @param {number} legIndex - legIndex du point courant
 * @param {number|null} pk   - pk interpolé courant (null hors corridor)
 * @returns {string|null}
 */
export function findSector(routeCfg, legIndex, pk) {
    const leg = routeCfg?.legs?.[legIndex];
    if (!leg) return null;
    if (Array.isArray(leg.sectors) && Number.isFinite(pk)) {
        for (const s of leg.sectors) {
            if (pk >= s.pkFrom && pk <= s.pkTo) return s.name;
        }
    }
    return leg.sector ?? null;
}
