// js/fakeGeoSim.js

// --- TOGGLE UNIQUE ---
// Passez à false pour désactiver totalement la simulation (GPS réel utilisé).
const ENABLE_FAKE_GPS = true

// ----------------------

import { STATE } from './state.js';

(function () {
    if (!ENABLE_FAKE_GPS) {
        console.log("⏹ Simulation GPS désactivée (ENABLE_FAKE_GPS = false).");
        return; // Ne touche pas à navigator.geolocation
    }

    console.log("🚀 Simulation GPS ACTIVÉE (ENABLE_FAKE_GPS = true).");

    // --- CONFIG ---
    const SPEED_MULTIPLIER = 15;      // Facteur d'accélération global
    const UPDATE_INTERVAL_MS = 1000; // Fréquence de mise à jour (ms)

    // Horloge de départ réinitialisable
    let START_TIME = Date.now();

    // Fonction de reset appelée avant de démarrer le tracking
    function resetFakeGpsStartTime() {
        START_TIME = Date.now();
        console.log("⏱ Réinitialisation de l'horloge de simulation GPS (START_TIME remis à maintenant).");
    }

    // On expose les paramètres au scope global pour app.js
    window.resetFakeGpsStartTime = resetFakeGpsStartTime;
    window.FAKE_GPS_SPEED_MULTIPLIER = SPEED_MULTIPLIER;

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

                return { latitude: lat, longitude: lon, finished: false };
            }

            timeElapsed -= segmentDuration;
            currentSegment++;
        }

        const lastPt = route[route.length - 1];
        console.log("[FAKE GPS] Terminus atteint, position finale.");
        return { latitude: lastPt.lat, longitude: lastPt.lon, finished: true };
    }

    const mockGeoLocation = {
        getCurrentPosition: function (success, _error, _options) {
            const pos = getSimulatedPosition();
            console.log(
                `📍 [MOCK] getCurrentPosition -> Lat: ${pos.latitude.toFixed(5)} Lon: ${pos.longitude.toFixed(5)}`
            );
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
        },
        watchPosition: function (success, _error, _options) {
            console.log("👀 [MOCK] watchPosition démarré (simulation GPS)...");
            const firstPos = getSimulatedPosition();
            success({
                coords: {
                    latitude: firstPos.latitude,
                    longitude: firstPos.longitude,
                    accuracy: 10,
                    speed: 30,
                    heading: null,
                    altitude: null
                },
                timestamp: Date.now()
            });

            const intervalId = setInterval(() => {
                const p = getSimulatedPosition();
                success({
                    coords: {
                        latitude: p.latitude,
                        longitude: p.longitude,
                        accuracy: 10,
                        speed: 30,
                        heading: null,
                        altitude: null
                    },
                    timestamp: Date.now()
                });

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
