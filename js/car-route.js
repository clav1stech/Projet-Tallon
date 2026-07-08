// js/car-route.js
// Construction de la route voiture hybride (corridor PK + waypoints manuels)
// et calcul d'ETA. Logique PURE (pas de DOM, pas de fetch) → testable Vitest.
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
 *             legs: Array<{index:number, type:string, label:string, startIdx:number, endIdx:number, startKm:number, endKm:number}> }}
 *   Chaque point porte : lat, lon, legIndex, legLabel, et selon le leg :
 *   pk + line (corridor) ou id + name (waypoints). `durationEffective`
 *   (secondes vers le point suivant) est calculée depuis avgSpeedKmh — elle
 *   alimente la simulation fakeGeoSim et l'ETA théorique de secours.
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

    return { points, cumKm, totalKm: cumKm[cumKm.length - 1], legs };
}

/**
 * ETA en secondes : distance restante ÷ vitesse moyenne glissante des
 * derniers échantillons fiables, avec un plancher pour éviter une ETA
 * infinie à l'arrêt (péage, feu rouge).
 * @param {number} remainingKm
 * @param {Array<{v:number, reliable:boolean}>} speedSamples - type STATE.speedHistory
 * @param {object} [opts] - { minSpeedKmh=20, maxSamples=120 }
 * @returns {number|null} secondes, ou null si aucun échantillon fiable
 */
export function computeEtaSeconds(remainingKm, speedSamples, { minSpeedKmh = 20, maxSamples = 120 } = {}) {
    if (!Number.isFinite(remainingKm) || remainingKm < 0) return null;
    if (remainingKm === 0) return 0;

    const reliable = (speedSamples || [])
        .filter(s => s && s.reliable && Number.isFinite(s.v))
        .slice(-maxSamples);
    if (reliable.length === 0) return null;

    const avg = reliable.reduce((sum, s) => sum + s.v, 0) / reliable.length;
    const effectiveSpeed = Math.max(avg, minSpeedKmh);
    return (remainingKm / effectiveSpeed) * 3600;
}
