// js/functions.js
import { computeSegmentProgress, haversineDistance } from './geo.js';

const MIN_ROUTE_TOLERANCE_KM = 0.25;
const BASE_MAX_OFFSET_KM = 0.6;
const CURVE_ALLOWANCE_RATIO = 0.08;
const POINT_MATCH_TOLERANCE_KM = 0.9;

/**
 * Croise le dictionnaire global `pointsDict` avec les points d'un trajet.
 * Retourne un tableau de points enrichis (données géo + métadonnées métier fusionnées).
 * Réutilisable pour toute consommation hors-éditeur.
 * @param {Object} pointsDict - Dictionnaire global { [id]: { lat, lon, ... } }
 * @param {Array}  trajetPoints - Tableau du trajet [{ id, durationToNext, ... }]
 */
function denormalizePoints(pointsDict, trajetPoints) {
    return (trajetPoints || []).map(pt => ({ ...(pointsDict[pt.id] || {}), ...pt }));
}

/**
 * Construit une route effective à partir d'un service pattern et des trajets.
 * @param {string} patternId
 * @param {number} globalDeltaSeconds
 * @param {Object} pointsGlobal - Dictionnaire global des points (clé = id)
 * @param {Array}  trajets      - Tableau des trajets (schéma v3)
 * @param {Array}  servicePatterns
 */
export function buildEffectiveRoute(patternId, globalDeltaSeconds, pointsGlobal, trajets, servicePatterns) {
    const pattern = (servicePatterns || []).find(p => p.id === patternId);
    if (!pattern) {
        throw new Error(`Pattern non trouvé: ${patternId}`);
    }

    const trajet = (trajets || []).find(m => m.id === pattern.masterRouteId);
    if (!trajet) {
        throw new Error(`Trajet non trouvé: ${pattern.masterRouteId}`);
    }

    // Croisement dictionnaire points + séquence du trajet
    const voie = trajet.voie || 1;
    const points = denormalizePoints(pointsGlobal, trajet.points).map(p => {
        // Pour les bifurcations, substituer lat/lon par les coordonnées de la voie courante
        if (p.type === 'bifurcation') {
            const latV = p[`lat_V${voie}`];
            const lonV = p[`lon_V${voie}`];
            if (typeof latV === 'number' && typeof lonV === 'number') {
                return { ...p, lat: latV, lon: lonV };
            }
        }
        return p;
    });

    const startIndex = points.findIndex(p => p.id === pattern.startPointId);
    const endIndex = points.findIndex(p => p.id === pattern.endPointId);

    // ✅ DEBUG
    console.log(`[buildEffectiveRoute] Pattern: ${patternId}`);
    console.log(`[buildEffectiveRoute] Trajet: ${trajet.id}, ${points.length} points`);
    console.log(`[buildEffectiveRoute] startPointId: ${pattern.startPointId} → index ${startIndex}`);
    console.log(`[buildEffectiveRoute] endPointId: ${pattern.endPointId} → index ${endIndex}`);

    if (startIndex === -1 || endIndex === -1) {
        throw new Error(`startPointId ou endPointId introuvable dans la master route. startIndex=${startIndex}, endIndex=${endIndex}`);
    }

    // Déterminer si on va dans le sens inverse
    const isReversed = startIndex > endIndex;

    // Extraire la sous-séquence dans l'ordre croissant des indices
    let slice;
    if (!isReversed) {
        slice = points.slice(startIndex, endIndex + 1);
    } else {
        slice = points.slice(endIndex, startIndex + 1);
    }

    // Si inversé, on retourne le tableau
    if (isReversed) {
        slice = [...slice].reverse();
    }

    const n = slice.length;

    // =====================================================
    // RECALCUL DES DUREES ET DISTANCES POUR CHAQUE SEGMENT
    // =====================================================
    const baseDurations = new Array(n).fill(0);
    const segmentLengths = new Array(n).fill(0);

    for (let i = 0; i < n - 1; i++) {
        const fromPoint = slice[i];
        const toPoint = slice[i + 1];

        if (isReversed) {
            baseDurations[i] = Number(toPoint.durationToNext || 0);
        } else {
            baseDurations[i] = Number(fromPoint.durationToNext || 0);
        }
        // Distance calculée exclusivement par Haversine (source de vérité GPS)
        segmentLengths[i] = haversineDistance(
            fromPoint.lat, fromPoint.lon,
            toPoint.lat, toPoint.lon
        );
    }
    // Le dernier point n'a pas de segment suivant
    baseDurations[n - 1] = 0;
    segmentLengths[n - 1] = 0;

    // =====================================================
    // 2) GESTION DES ARRÊTS (PÉNALITÉ DE TEMPS)
    // =====================================================
    // Règle : 6 minutes (360s) par arrêt intermédiaire.
    // Répartition : 25% sur le segment d'avant (freinage), 75% sur le segment d'après (départ).
    
    const STOP_PENALTY = 360; // secondes
    const stopIds = pattern.stops || [];

    for (let i = 0; i < n; i++) {
        const p = slice[i];
        
        // Si ce point n'est pas un arrêt marqué, on ignore
        if (!stopIds.includes(p.id)) continue;

        // On n'applique pas de pénalité au point de départ (i=0) ni au terminus (i=n-1)
        if (i === 0 || i === n - 1) continue;

        const extraBefore = Math.round(STOP_PENALTY * 0.25); // 90s
        const extraAfter = Math.round(STOP_PENALTY * 0.75);  // 270s

        // Ajout au segment PRÉCÉDENT (arrivée en gare)
        // baseDurations[i-1] est la durée pour aller de (i-1) à (i)
        if (i - 1 >= 0) {
            baseDurations[i - 1] += extraBefore;
        }

        // Ajout au segment SUIVANT (départ de gare)
        // baseDurations[i] est la durée pour aller de (i) à (i+1)
        if (i < n - 1) {
            baseDurations[i] += extraAfter;
        }
    }

    // 3) Application du ΔT global via un facteur de scale
    const totalBase = baseDurations.reduce((sum, v) => sum + v, 0);
    const totalWithDelta = totalBase + (globalDeltaSeconds || 0);
    const scale = totalBase > 0 ? (totalWithDelta / totalBase) : 1;

    const durationEffective = baseDurations.map(d => Math.round(d * scale));

    // 4) Construire les points enrichis
    const effectivePoints = slice.map((p, idx) => {
        const isStop = stopIds.includes(p.id);
        return {
            ...p,
            baseDuration: baseDurations[idx] || 0,
            durationEffective: durationEffective[idx] || 0,
            isStop,
            segmentLengthToNext: segmentLengths[idx] || 0
        };
    });

    return {
        points: effectivePoints,
        direction: isReversed ? 'NORD' : (trajet.direction || 'SUD')
    };
}

/**
 * Calcule un timestamp de départ (en ms) à partir d'une heure "HH:MM" pour aujourd'hui.
 * @param {string} timeStr
 * @returns {number|null}
 */
export function computeDepartureTimestamp(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const [hStr, mStr] = timeStr.split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;

    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
}

/**
 * Calcule la projection d'un point P sur un segment [A, B]
 * Retourne le ratio (0 = A, 1 = B, >1 = dépassé B, <0 = avant A)
 */
function projectOnSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    const abLat = bLat - aLat;
    const abLon = bLon - aLon;
    const apLat = pLat - aLat;
    const apLon = pLon - aLon;

    const dotProduct = apLat * abLat + apLon * abLon;
    const abLengthSq = abLat * abLat + abLon * abLon;

    if (abLengthSq === 0) return 0;

    // Ratio NON BORNÉ : peut être < 0 ou > 1
    return dotProduct / abLengthSq;
}

function buildSegmentCandidate(pStart, pEnd, lat, lon, preferredRatio = null) {
    if (!pStart || !pEnd) return null;
    if (typeof pStart.lat !== 'number' || typeof pStart.lon !== 'number') return null;
    if (typeof pEnd.lat !== 'number' || typeof pEnd.lon !== 'number') return null;

    const segmentLengthKm = getSegmentLength(pStart, pEnd);
    if (!segmentLengthKm || segmentLengthKm <= 0) {
        return null;
    }

    let ratio = Number.isFinite(preferredRatio) ? preferredRatio : null;
    if (ratio === null) {
        ratio = projectOnSegment(lat, lon, pStart.lat, pStart.lon, pEnd.lat, pEnd.lon);
    }

    const clampedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const projLat = pStart.lat + (pEnd.lat - pStart.lat) * clampedRatio;
    const projLon = pStart.lon + (pEnd.lon - pStart.lon) * clampedRatio;
    const offsetKm = haversineDistance(lat, lon, projLat, projLon);

    return {
        ratio: clampedRatio,
        distanceFromSegmentStart: clampedRatio * segmentLengthKm,
        distanceToNextPointKm: Math.max(0, segmentLengthKm - clampedRatio * segmentLengthKm),
        segmentLengthKm,
        offsetKm
    };
}

function isSouthboundRoute(route, direction) {
    const dir = (direction || '').toString().toUpperCase();
    if (dir.includes('SUD') || dir.includes('SOUTH')) return true;
    if (dir.includes('NORD') || dir.includes('NORTH')) return false;

    const first = route?.[0];
    const last = route?.[route.length - 1];
    if (!first || !last) return null;
    if (typeof first.lat !== 'number' || typeof last.lat !== 'number') return null;
    return last.lat < first.lat;
}

function fallbackSegmentByLatitude(route, lat, lon, lastSegmentIndex, direction) {
    if (!route || route.length < 2) return null;
    if (typeof lat !== 'number') return null;

    const southbound = isSouthboundRoute(route, direction);
    if (southbound === null) return null;

    const hasLastIndex = Number.isFinite(lastSegmentIndex) && lastSegmentIndex >= 0;
    const startIdx = hasLastIndex ? Math.min(lastSegmentIndex, route.length - 2) : 0;

    const findSegmentIdx = (fromIdx) => {
        for (let i = fromIdx; i < route.length - 1; i++) {
            const pStart = route[i];
            const pEnd = route[i + 1];
            if (!pStart || !pEnd) continue;
            if (typeof pStart.lat !== 'number' || typeof pEnd.lat !== 'number') continue;

            const isWithinLatBounds = southbound
                ? lat <= pStart.lat && lat >= pEnd.lat
                : lat >= pStart.lat && lat <= pEnd.lat;

            if (isWithinLatBounds) return i;
        }
        return null;
    };

    let segmentIndex = findSegmentIdx(startIdx);
    if (segmentIndex === null && startIdx > 0) {
        segmentIndex = findSegmentIdx(0);
    }
    if (segmentIndex === null) {
        const first = route[0];
        const last = route[route.length - 1];
        if (!first || !last || typeof first.lat !== 'number' || typeof last.lat !== 'number') {
            return null;
        }

        if (southbound) {
            segmentIndex = lat > first.lat ? 0 : route.length - 2;
        } else {
            segmentIndex = lat < first.lat ? 0 : route.length - 2;
        }
    } else if (hasLastIndex) {
        segmentIndex = Math.max(segmentIndex, Math.min(route.length - 2, lastSegmentIndex));
    }

    const progress = computeSegmentProgress(route, segmentIndex, lat, lon);
    const distanceFromSegmentStart = progress?.distanceFromStart || 0;
    const segmentLength = progress?.segmentLength || 0;

    return {
        segmentIndex,
        distanceFromSegmentStart,
        distanceToNextPointKm: Math.max(0, segmentLength - distanceFromSegmentStart)
    };
}

/**
 * Détermine sur quel segment se trouve une position (lat, lon)
 * EN RESPECTANT LE SENS DE CIRCULATION
 * 
 * Règle : on ne passe au segment suivant QUE si on a DÉPASSÉ le point Next
 * (ratio > 1 sur le segment actuel)
 * 
 * @param {Array} route - Les points de la route
 * @param {number} lat - Latitude actuelle
 * @param {number} lon - Longitude actuelle
 * @param {number|null} lastSegmentIndex - Dernier segment validé
 * @param {number|null} accuracyMeters - Précision GPS en mètres
 * @param {string|null} direction - Sens de circulation (ex: SUD/NORD)
 * @returns {{ segmentIndex, distanceFromSegmentStart, distanceToNextPointKm }}
 */
export function computeSegmentIndexAndDistance(route, lat, lon, lastSegmentIndex = null, accuracyMeters = null, direction = null) {
    if (!route || route.length < 2) {
        return { segmentIndex: null, distanceFromSegmentStart: 0, distanceToNextPointKm: 0 };
    }

    const toleranceKm = Math.max(
        MIN_ROUTE_TOLERANCE_KM,
        Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters / 1000 : 0
    );
    const baseMaxOffset = Math.max(toleranceKm, BASE_MAX_OFFSET_KM);

    const hasLastIndex = Number.isFinite(lastSegmentIndex) && lastSegmentIndex >= 0;
    const startIdx = hasLastIndex ? Math.max(0, lastSegmentIndex - 2) : 0;
    const endIdx = hasLastIndex ? Math.min(route.length - 2, lastSegmentIndex + 3) : route.length - 2;

    const findBestCandidate = (fromIdx, toIdx) => {
        let bestCandidate = null;

        for (let idx = fromIdx; idx <= toIdx; idx++) {
            const pStart = route[idx];
            const pEnd = route[idx + 1];
            if (!pStart || !pEnd) continue;

            const candidate = buildSegmentCandidate(pStart, pEnd, lat, lon);
            if (!candidate) continue;

            const withTolerance = candidate.offsetKm <= toleranceKm;
            if (
                withTolerance &&
                (!bestCandidate ||
                    bestCandidate.offsetKm > toleranceKm ||
                    candidate.offsetKm < bestCandidate.offsetKm)
            ) {
                bestCandidate = { segmentIndex: idx, ...candidate };
                continue;
            }

            if (!bestCandidate || (bestCandidate.offsetKm > toleranceKm && candidate.offsetKm < bestCandidate.offsetKm)) {
                bestCandidate = { segmentIndex: idx, ...candidate };
            }
        }

        return bestCandidate;
    };

    let bestCandidate = findBestCandidate(startIdx, endIdx);
    if (!bestCandidate && hasLastIndex) {
        bestCandidate = findBestCandidate(0, route.length - 2);
    }

    const isWithinAllowedOffset = (candidate) => {
        const curveAllowanceKm = candidate.segmentLengthKm * CURVE_ALLOWANCE_RATIO;
        const maxAcceptableOffset = Math.max(baseMaxOffset, curveAllowanceKm);
        return candidate.offsetKm <= maxAcceptableOffset;
    };

    if (!bestCandidate || !isWithinAllowedOffset(bestCandidate)) {
        let nearestPointIdx = null;
        let nearestPointDistKm = Infinity;
        const pointToleranceKm = Math.max(
            POINT_MATCH_TOLERANCE_KM,
            Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters / 1000 : 0
        );

        for (let i = 0; i < route.length; i++) {
            const p = route[i];
            if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
            const d = haversineDistance(lat, lon, p.lat, p.lon);
            if (d < nearestPointDistKm) {
                nearestPointDistKm = d;
                nearestPointIdx = i;
            }
        }

        if (nearestPointIdx === null || nearestPointDistKm > pointToleranceKm) {
            const fallback = fallbackSegmentByLatitude(route, lat, lon, lastSegmentIndex, direction);
            if (fallback) return fallback;
            return { segmentIndex: null, distanceFromSegmentStart: 0, distanceToNextPointKm: 0 };
        }

        const segmentIndex = Math.max(0, Math.min(route.length - 2, nearestPointIdx));
        return {
            segmentIndex,
            distanceFromSegmentStart: 0,
            distanceToNextPointKm: 0
        };
    }

    if (!bestCandidate) {
        const fallback = fallbackSegmentByLatitude(route, lat, lon, lastSegmentIndex, direction);
        if (fallback) return fallback;
        return { segmentIndex: null, distanceFromSegmentStart: 0, distanceToNextPointKm: 0 };
    }

    return {
        segmentIndex: bestCandidate.segmentIndex,
        distanceFromSegmentStart: bestCandidate.distanceFromSegmentStart,
        distanceToNextPointKm: bestCandidate.distanceToNextPointKm
    };
}

/**
 * Calcule la longueur d'un segment en km
 */
function getSegmentLength(pStart, pEnd) {
    let length = Number(pStart.segmentLengthToNext || 0);
    if (!length || length <= 0) {
        length = haversineDistance(pStart.lat, pStart.lon, pEnd.lat, pEnd.lon);
    }
    return length;
}

/**
 * Calcule le retard courant (en ms)
 */
export function computeCurrentDelay(route, segmentIndex, distanceFromStart, departureTimestamp, nowTs = Date.now()) {
    if (!route || !route.length || departureTimestamp == null || segmentIndex == null || segmentIndex < 0) {
        return 0;
    }

    // Temps cumulé des segments COMPLETS (avant le segment actuel)
    let cumSeconds = 0;
    for (let i = 0; i < segmentIndex && i < route.length; i++) {
        const segDur = Number(route[i].durationEffective ?? route[i].baseDuration ?? route[i].baseDurationToNext ?? 0);
        cumSeconds += segDur;
    }

    // Progression sur le segment actuel
    const segPoint = route[segmentIndex];
    const segDuration = Number(segPoint.durationEffective ?? segPoint.baseDuration ?? segPoint.baseDurationToNext ?? 0);
    const segLength = getSegmentLength(segPoint, route[segmentIndex + 1] || segPoint);

    // Ratio de progression sur le segment (0 à 1)
    const ratio = segLength > 0 ? Math.max(0, Math.min(1, distanceFromStart / segLength)) : 0;

    // Temps théorique = temps cumulé + (ratio × durée du segment actuel)
    const currentTheoSeconds = cumSeconds + ratio * segDuration;
    const theoTimestampMs = departureTimestamp + currentTheoSeconds * 1000;

    return nowTs - theoTimestampMs;
}
