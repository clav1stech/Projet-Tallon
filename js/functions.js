// js/functions.js
import { computeSegmentProgress, haversineDistance } from './geo.js';

/**
 * Construit une route effective à partir d'un service pattern et de la master route.
 */
export function buildEffectiveRoute(patternId, globalDeltaSeconds, masterRoutes, servicePatterns) {
    const pattern = (servicePatterns || []).find(p => p.id === patternId);
    if (!pattern) {
        throw new Error(`Pattern non trouvé: ${patternId}`);
    }

    const master = (masterRoutes || []).find(m => m.id === pattern.masterRouteId);
    if (!master) {
        throw new Error(`Master route non trouvée: ${pattern.masterRouteId}`);
    }

    const points = master.points || [];

    const startIndex = points.findIndex(p => p.id === pattern.startPointId);
    const endIndex = points.findIndex(p => p.id === pattern.endPointId);

    // ✅ DEBUG
    console.log(`[buildEffectiveRoute] Pattern: ${patternId}`);
    console.log(`[buildEffectiveRoute] Master: ${master.id}, ${points.length} points`);
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
            baseDurations[i] = Number(toPoint.baseDurationToNext || 0);
            segmentLengths[i] = haversineDistance(
                fromPoint.lat, fromPoint.lon,
                toPoint.lat, toPoint.lon
            );
        } else {
            baseDurations[i] = Number(fromPoint.baseDurationToNext || 0);
            segmentLengths[i] = Number(fromPoint.segmentLengthToNext || 0);
            
            if (segmentLengths[i] <= 0) {
                segmentLengths[i] = haversineDistance(
                    fromPoint.lat, fromPoint.lon,
                    toPoint.lat, toPoint.lon
                );
            }
        }
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
        direction: isReversed ? 'NORD' : (master.direction || 'SUD')
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
 * @returns {{ segmentIndex, distanceFromSegmentStart, distanceToNextPointKm }}
 */
export function computeSegmentIndexAndDistance(route, lat, lon, lastSegmentIndex = null) {
    if (!route || route.length < 2) {
        return { segmentIndex: null, distanceFromSegmentStart: 0, distanceToNextPointKm: 0 };
    }

    // Segment actuel (ou 0 si pas encore initialisé)
    let currentSeg = (lastSegmentIndex !== null && lastSegmentIndex >= 0) 
        ? lastSegmentIndex 
        : 0;

    // Boucle : tant qu'on a dépassé le point suivant, on avance
    while (currentSeg < route.length - 1) {
        const pStart = route[currentSeg];
        const pEnd = route[currentSeg + 1];

        if (typeof pStart.lat !== 'number' || typeof pEnd.lat !== 'number') {
            break;
        }

        // Calculer le ratio de projection sur ce segment
        const ratio = projectOnSegment(
            lat, lon,
            pStart.lat, pStart.lon,
            pEnd.lat, pEnd.lon
        );

        // Si ratio <= 1, on est encore sur ce segment (pas dépassé le Next)
        if (ratio <= 1.0) {
            // On reste sur ce segment
            const segmentLength = getSegmentLength(pStart, pEnd);
            const clampedRatio = Math.max(0, Math.min(1, ratio));
            const distanceFromSegmentStart = clampedRatio * segmentLength;
            const distanceToNextPointKm = Math.max(0, segmentLength - distanceFromSegmentStart);

            return {
                segmentIndex: currentSeg,
                distanceFromSegmentStart,
                distanceToNextPointKm
            };
        }

        // ratio > 1 → on a dépassé le point Next → on avance au segment suivant
        console.log(`[Avancement] Dépassement du point ${pEnd.name} (ratio=${ratio.toFixed(2)})`);
        currentSeg++;
    }

    // On est arrivé au dernier segment
    const lastSeg = route.length - 2;
    const pStart = route[lastSeg];
    const pEnd = route[lastSeg + 1];
    const segmentLength = getSegmentLength(pStart, pEnd);

    return {
        segmentIndex: lastSeg,
        distanceFromSegmentStart: segmentLength,
        distanceToNextPointKm: 0
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
