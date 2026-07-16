// js/linearref.js
// Référencement linéaire (PK/PR) au-dessus du moteur de matching existant.
//
// Un CSV de points kilométriques (pk, lat, lon) est une polyline dense : le
// matching réutilise computeSegmentIndexAndDistance (fenêtre glissante,
// tolérance selon précision GPS, snap) tel quel — AUCUN nouveau moteur de
// projection. Le PK est interpolé entre les deux points bornant le segment
// matché, ce qui tolère les discontinuités de PK (raccords de lignes).
//
// Le fallback par latitude est désactivé ici : un corridor PK peut être
// orienté dans n'importe quelle direction (l'A40 est globalement ouest-est).

import { computeSegmentIndexAndDistance, buildSegmentCandidate } from './functions.js';
import { haversineDistance } from './geo.js';

// En-deçà de cette distance, deux points consécutifs sont considérés
// comme des doublons (raccords de fichiers, points répétés).
const DUPLICATE_POINT_KM = 0.001;

/**
 * Construit un corridor exploitable à partir des points d'un dataset
 * (sortie de csv.js). Filtre les points invalides et les doublons,
 * précalcule les distances cumulées.
 * @param {Array<{pk:number, lat:number, lon:number, line?:string, vmax?:number}>} datasetPoints
 * @returns {{ points: Array, cumKm: number[], totalKm: number, pkStart: number|null, pkEnd: number|null }}
 */
export function buildCorridor(datasetPoints) {
    const points = [];
    for (const p of datasetPoints || []) {
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.pk)) continue;
        const prev = points[points.length - 1];
        if (prev && haversineDistance(prev.lat, prev.lon, p.lat, p.lon) < DUPLICATE_POINT_KM) continue;
        points.push({
            lat: p.lat, lon: p.lon, pk: p.pk, line: p.line ?? null,
            vmax: Number.isFinite(p.vmax) ? p.vmax : null
        });
    }

    const cumKm = points.length > 0 ? [0] : [];
    for (let i = 1; i < points.length; i++) {
        cumKm.push(cumKm[i - 1] + haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon));
    }

    return {
        points,
        cumKm,
        totalKm: cumKm.length > 0 ? cumKm[cumKm.length - 1] : 0,
        pkStart: points.length > 0 ? points[0].pk : null,
        pkEnd: points.length > 0 ? points[points.length - 1].pk : null
    };
}

/**
 * Localise une position GPS sur un corridor : segment matché + PK interpolé.
 * Réutilise le matcher existant (fenêtre autour de lastIndex, tolérance selon
 * la précision GPS) avec le fallback latitude désactivé.
 * @param {ReturnType<typeof buildCorridor>} corridor
 * @param {number} lat
 * @param {number} lon
 * @param {number|null} [lastIndex] - dernier index matché (fenêtre de recherche)
 * @param {number|null} [accuracyMeters]
 * @returns {{ index:number, pk:number, line:string|null, vmax:number|null,
 *             distanceFromStartKm:number, distanceToEndKm:number,
 *             offsetKm:number|null } | null}
 *          null si la position est hors corridor.
 */
export function locateOnCorridor(corridor, lat, lon, lastIndex = null, accuracyMeters = null) {
    if (!corridor || !Array.isArray(corridor.points) || corridor.points.length < 2) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const { segmentIndex, distanceFromSegmentStart } = computeSegmentIndexAndDistance(
        corridor.points, lat, lon, lastIndex, accuracyMeters, null,
        { disableLatitudeFallback: true }
    );
    if (segmentIndex == null || segmentIndex < 0) return null;

    const a = corridor.points[segmentIndex];
    const b = corridor.points[segmentIndex + 1];
    const segLen = corridor.cumKm[segmentIndex + 1] - corridor.cumKm[segmentIndex];
    const ratio = segLen > 0 ? Math.max(0, Math.min(1, distanceFromSegmentStart / segLen)) : 0;

    // Interpolation PAR SEGMENT : un saut de PK entre deux lignes ne
    // contamine pas les segments voisins.
    const pk = a.pk + ratio * (b.pk - a.pk);
    const distanceFromStartKm = corridor.cumKm[segmentIndex] + ratio * segLen;
    const candidate = buildSegmentCandidate(a, b, lat, lon);

    return {
        index: segmentIndex,
        pk,
        line: a.line ?? null,
        // Vitesse limite du segment matché (celle de son point de départ) ;
        // les points PK SNCF sont assez denses pour que l'approximation suffise.
        vmax: a.vmax ?? null,
        distanceFromStartKm,
        distanceToEndKm: Math.max(0, corridor.totalKm - distanceFromStartKm),
        offsetKm: candidate ? candidate.offsetKm : null
    };
}

/**
 * Formate un PK décimal en notation "km+mètres" : 123.456 → "123+456".
 * @param {number} pkKm
 * @returns {string}
 */
export function formatPk(pkKm) {
    if (!Number.isFinite(pkKm)) return '';
    const sign = pkKm < 0 ? '-' : '';
    const abs = Math.abs(pkKm);
    let km = Math.floor(abs);
    let m = Math.round((abs - km) * 1000);
    if (m === 1000) { km += 1; m = 0; }
    return `${sign}${km}+${String(m).padStart(3, '0')}`;
}
