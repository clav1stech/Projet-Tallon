// js/fakeGeoSim.js

// --- TOGGLE UNIQUE ---
// Passez à false pour désactiver totalement la simulation (GPS réel utilisé).
const ENABLE_FAKE_GPS = false

// ----------------------

import { STATE } from './state.js';
import { buildCumulativeDistances, haversineDistance } from './geo.js';

(function () {
    if (!ENABLE_FAKE_GPS) {
        console.log("⏹ Simulation GPS désactivée (ENABLE_FAKE_GPS = false).");
        return; // Ne touche pas à navigator.geolocation
    }

    console.log("🚀 Simulation GPS ACTIVÉE (ENABLE_FAKE_GPS = true).");

    // --- CONFIG ---
    const SPEED_MULTIPLIER = 10;      // Facteur d'accélération global
    const UPDATE_INTERVAL_MS = 1000; // Fréquence de mise à jour (ms)
    // Point de départ de la simulation, en km parcourus le long de la route
    // (STATE.currentRoute) plutôt qu'au tout début. 0 = comportement habituel.
    const START_OFFSET_KM = 0;

    // Horloge de départ réinitialisable
    let START_TIME = Date.now();

    // Temps simulé (secondes) équivalent à START_OFFSET_KM le long de la
    // route courante : distance cumulée par tronçon (Haversine, comme
    // buildEffectiveRoute/buildCarRoute), interpolé dans durationEffective.
    function offsetKmToSeconds(route, offsetKm) {
        if (!route || route.length < 2 || offsetKm <= 0) return 0;
        let cumKm = 0;
        let cumSeconds = 0;
        for (let i = 0; i < route.length - 1; i++) {
            const segKm = haversineDistance(route[i].lat, route[i].lon, route[i + 1].lat, route[i + 1].lon);
            const segSeconds = Number(route[i].durationEffective ?? route[i].baseDurationToNext ?? 0);
            if (offsetKm <= cumKm + segKm) {
                const ratio = segKm > 0 ? (offsetKm - cumKm) / segKm : 0;
                return cumSeconds + ratio * segSeconds;
            }
            cumKm += segKm;
            cumSeconds += segSeconds;
        }
        return cumSeconds; // offsetKm au-delà de la route : juste avant l'arrivée
    }

    // Fonction de reset appelée avant de démarrer le tracking
    function resetFakeGpsStartTime() {
        const offsetSeconds = offsetKmToSeconds(STATE.currentRoute, START_OFFSET_KM);
        START_TIME = Date.now() - (offsetSeconds / SPEED_MULTIPLIER) * 1000;
        console.log(
            `⏱ Réinitialisation de l'horloge de simulation GPS ` +
            `(START_OFFSET_KM=${START_OFFSET_KM} → ${offsetSeconds.toFixed(0)}s de route simulée déjà écoulées).`
        );
    }

    // On expose les paramètres au scope global pour app.js
    window.resetFakeGpsStartTime = resetFakeGpsStartTime;
    window.FAKE_GPS_SPEED_MULTIPLIER = SPEED_MULTIPLIER;

    // Km cumulés de la route courante, recalculés au seul changement de route.
    let cachedRoute = null;
    let cachedCumKm = [];
    function routeCumKm(route) {
        if (cachedRoute !== route) {
            cachedRoute = route;
            cachedCumKm = buildCumulativeDistances(route);
        }
        return cachedCumKm;
    }

    // Zones sans signal déclarées par le mode courant (tunnels du mode voiture).
    // La simulation s'y tait au lieu d'émettre : c'est la seule façon de
    // rejouer la péremption du signal, donc la progression estimée et
    // l'affichage « tunnel », sans prendre la route.
    let currentGap = null;
    function signalGapAt(routeKm) {
        const gaps = window.FAKE_GPS_SIGNAL_GAPS;
        if (!Array.isArray(gaps) || !Number.isFinite(routeKm)) return null;
        return gaps.find(g => routeKm >= g.startKm && routeKm <= g.endKm) || null;
    }

    /** @returns {boolean} true si la position a été émise, false si sous tunnel */
    function emitUnlessInGap(success, pos) {
        const gap = signalGapAt(pos.routeKm);
        if (gap) {
            if (currentGap !== gap.name) {
                currentGap = gap.name;
                console.log(`🚇 [MOCK] Entrée dans ${gap.name} — plus aucune position jusqu'à la sortie.`);
            }
            return false;
        }
        if (currentGap) {
            console.log(`🚇 [MOCK] Sortie de ${currentGap} — émission reprise.`);
            currentGap = null;
        }
        success({
            coords: {
                latitude: pos.latitude,
                longitude: pos.longitude,
                accuracy: 10,
                speed: 30,
                heading: null,
                altitude: null
            },
            timestamp: Date.now()
        });
        return true;
    }

    function getSimulatedPosition() {
        const route = STATE.currentRoute;

        if (!route || route.length === 0) {
            return { latitude: 48.84431, longitude: 2.37564, finished: false };
        }

        const now = Date.now();
        let timeElapsed = (now - START_TIME) * SPEED_MULTIPLIER;
        let currentSegment = 0;

        // durée du segment i -> i+1 est stockée sur le point de départ (currentRoute[i])
        while (currentSegment < route.length - 1) {
            const segmentDuration =
                Number(route[currentSegment].durationEffective ?? route[currentSegment].baseDurationToNext ?? 0) * 1000;

            if (timeElapsed < segmentDuration) {
                const startPt = route[currentSegment];
                const endPt = route[currentSegment + 1];

                const progress = segmentDuration > 0 ? (timeElapsed / segmentDuration) : 1;

                const lat = startPt.lat + (endPt.lat - startPt.lat) * progress;
                const lon = startPt.lon + (endPt.lon - startPt.lon) * progress;

                console.log(
                    `[FAKE GPS] segment=${currentSegment}, elapsed=${(timeElapsed / 1000).toFixed(1)}s, dur=${(segmentDuration / 1000).toFixed(1)}s, lat=${lat.toFixed(5)}, lon=${lon.toFixed(5)}`
                );

                const cumKm = routeCumKm(route);
                const routeKm = Number.isFinite(cumKm[currentSegment])
                    ? cumKm[currentSegment] + progress * (cumKm[currentSegment + 1] - cumKm[currentSegment])
                    : null;

                return { latitude: lat, longitude: lon, routeKm, finished: false };
            }

            timeElapsed -= segmentDuration;
            currentSegment++;
        }

        const lastPt = route[route.length - 1];
        const cumKm = routeCumKm(route);
        console.log("[FAKE GPS] Terminus atteint, position finale.");
        return {
            latitude: lastPt.lat,
            longitude: lastPt.lon,
            routeKm: cumKm[cumKm.length - 1] ?? null,
            finished: true
        };
    }

    const mockGeoLocation = {
        getCurrentPosition: function (success, _error, _options) {
            const pos = getSimulatedPosition();
            console.log(
                `📍 [MOCK] getCurrentPosition -> Lat: ${pos.latitude.toFixed(5)} Lon: ${pos.longitude.toFixed(5)}`
            );
            emitUnlessInGap(success, pos);
        },
        watchPosition: function (success, _error, _options) {
            console.log("👀 [MOCK] watchPosition démarré (simulation GPS)...");
            emitUnlessInGap(success, getSimulatedPosition());

            const intervalId = setInterval(() => {
                const p = getSimulatedPosition();
                emitUnlessInGap(success, p);

                if (p.finished) {
                    console.log("🏁 [MOCK] Terminus (fin du trajet simulé) !");
                    clearInterval(intervalId);
                }
            }, UPDATE_INTERVAL_MS);

            return intervalId;
        },
        clearWatch: function (id) {
            clearInterval(id);
        }
    };

    try {
        Object.defineProperty(navigator, 'geolocation', {
            value: mockGeoLocation,
            writable: true,
            configurable: true
        });
        console.log("✅ navigator.geolocation surchargé via Object.defineProperty.");
    } catch (e) {
        try {
            navigator.geolocation = mockGeoLocation;
            console.log("✅ navigator.geolocation surchargé via affectation directe (fallback).");
        } catch (e2) {
            console.warn("⚠️ Impossible de surcharger navigator.geolocation dans cet environnement.", e2);
        }
    }

})();
