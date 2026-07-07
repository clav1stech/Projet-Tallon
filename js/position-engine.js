// js/position-engine.js
// Pipeline de fiabilité GPS réutilisable entre les modes (rail / voiture).
//
// Composition PURE des helpers de tracking.js — aucune math dupliquée, aucun
// accès au DOM ni à STATE. Reproduit exactement l'ordre de la chaîne de
// filtres historique de showPosition() (app.js) :
//   précision → anti-téléportation (avec ré-ancrage) → historique de positions
//   → vitesse médiane → plancher de bruit → anti-pic → clamp.
//
// app.js (rail) conserve son implémentation en place (non-régression) ;
// car-app.js consomme ce moteur. Basculer app.js dessus est une évolution
// optionnelle et isolée.

import {
    shouldAcceptAccuracy,
    evaluateTeleport,
    medianStepSpeed,
    noiseFloorKmh,
    filterSpeedSpike
} from './tracking.js';

/**
 * Crée un moteur de position avec son état interne (dernière position de
 * confiance, compteur de rejets, historique de positions, vitesse précédente).
 *
 * @param {object} [opts]
 * @param {number}   [opts.maxSpeedKmh=350]        - clamp de vitesse (350 rail, ~150 voiture)
 * @param {boolean}  [opts.trustReportedSpeed=false] - utiliser coords.speed si fourni (WiFi SNCF)
 * @param {Function} [opts.speedDivisor]           - () => facteur de division de la vitesse
 *                                                   (simulation fakeGeoSim : positions accélérées ×N)
 * @param {number}   [opts.historySize=10]         - taille de l'historique de positions (s à 1 pt/s)
 * @param {number}   [opts.maxAccuracyM]           - override du filtre de précision (tracking.js)
 * @param {number}   [opts.overrideMs]             - override du mode dégradé (tracking.js)
 * @param {number}   [opts.teleportThresholdKmh]   - override du seuil anti-téléportation
 * @param {number}   [opts.teleportMaxRejections]  - override du nb de rejets avant ré-ancrage
 * @returns {{ process: Function, reset: Function }}
 */
export function createPositionEngine(opts = {}) {
    const maxSpeedKmh = opts.maxSpeedKmh ?? 350;
    const trustReportedSpeed = opts.trustReportedSpeed ?? false;
    const speedDivisor = opts.speedDivisor ?? (() => 1);
    const historySize = opts.historySize ?? 10;
    const accuracyOpts = { maxAccuracyM: opts.maxAccuracyM, overrideMs: opts.overrideMs };
    const teleportOpts = { thresholdKmh: opts.teleportThresholdKmh, maxRejections: opts.teleportMaxRejections };

    let lastTrusted = null;        // { lat, lon, ts }
    let rejections = 0;            // rejets anti-téléportation consécutifs
    let lastAcceptedFixMs = 0;     // pour le mode dégradé du filtre de précision
    let positions = [];            // historique pour la vitesse médiane
    let prevSpeed = null;          // pour le filtre anti-pic

    function reset() {
        lastTrusted = null;
        rejections = 0;
        lastAcceptedFixMs = 0;
        positions = [];
        prevSpeed = null;
    }

    /**
     * Traite un fix GPS (format navigator.geolocation).
     * @param {{ coords: { latitude, longitude, accuracy?, speed? } }} position
     * @param {number} [nowTs]
     * @returns {{ accepted:false, reason:'invalid'|'accuracy'|'teleport', accuracyMeters?:number }
     *         | { accepted:true, lat:number, lon:number, accuracyMeters:number|null,
     *             speedKmh:number, speedReliable:boolean, reseeded:boolean }}
     *   `reseeded: true` = position divergente persistante acceptée : l'appelant
     *   doit ré-ancrer son matching (reset de l'index de segment).
     */
    function process(position, nowTs = Date.now()) {
        const lat = position?.coords?.latitude;
        const lon = position?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return { accepted: false, reason: 'invalid' };
        }
        const accuracyMeters = Number(position.coords.accuracy);

        // 1. Filtre de précision (mode dégradé après disette de fix prolongée)
        if (!shouldAcceptAccuracy(accuracyMeters, lastAcceptedFixMs, nowTs, accuracyOpts)) {
            return { accepted: false, reason: 'accuracy', accuracyMeters };
        }

        // 2. Anti-téléportation avec récupération (ré-ancrage après N rejets)
        const verdict = evaluateTeleport(lastTrusted, lat, lon, nowTs, rejections, teleportOpts);
        rejections = verdict.rejections;
        if (!verdict.accept) {
            return { accepted: false, reason: 'teleport' };
        }
        const reseeded = verdict.reseeded;
        if (reseeded) {
            positions = [];
        }
        lastTrusted = { lat, lon, ts: nowTs };
        lastAcceptedFixMs = nowTs;

        // 3. Historique de positions pour la vitesse lissée
        positions.push({ lat, lon, ts: nowTs });
        if (positions.length > historySize) {
            positions.shift();
        }

        // 4. Vitesse : directe (si source de confiance) ou médiane + plancher de bruit
        const reportedSpeed = Number(position.coords.speed);
        const hasDirectSpeed = trustReportedSpeed && Number.isFinite(reportedSpeed) && reportedSpeed >= 0;

        let speedKmh = hasDirectSpeed ? reportedSpeed : 0;
        let speedReliable = hasDirectSpeed;
        if (!hasDirectSpeed && positions.length >= 2) {
            speedKmh = medianStepSpeed(positions);
            const first = positions[0];
            const last = positions[positions.length - 1];
            const windowSeconds = (last.ts - first.ts) / 1000;
            if (speedKmh < noiseFloorKmh(accuracyMeters, windowSeconds)) {
                speedKmh = 0;
            }
            speedReliable = true;
        }

        // 5. Correction simulation (positions accélérées ×N par fakeGeoSim)
        const divisor = Number(speedDivisor()) || 1;
        if (divisor !== 1) {
            speedKmh = speedKmh / divisor;
        }

        // 6. Anti-pic + clamp physique
        const base = prevSpeed == null ? speedKmh : prevSpeed;
        speedKmh = filterSpeedSpike(base, speedKmh);
        speedKmh = Math.max(0, Math.min(maxSpeedKmh, speedKmh));
        prevSpeed = speedKmh;

        return {
            accepted: true,
            lat,
            lon,
            accuracyMeters: Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters : null,
            speedKmh,
            speedReliable,
            reseeded
        };
    }

    return { process, reset };
}
