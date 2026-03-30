// js/fakeGeoSim.js

// --- TOGGLE UNIQUE ---
// Passez à false pour désactiver totalement la simulation (GPS réel utilisé).
const ENABLE_FAKE_GPS = true;

// ----------------------

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

    // On expose la fonction au scope global pour app.js
    window.resetFakeGpsStartTime = resetFakeGpsStartTime;

    // --- DONNÉES (lat, lon, durée stockée sur le POINT D'ARRIVÉE) ---
    // Interprétation : DATA_POINTS[i+1][2] = durée du segment i -> i+1
    const DATA_POINTS = [
        [48.84431, 2.37564, "00:00:00"],
        [48.77490, 2.43626, "00:05:50"],
        [48.74884, 2.47240, "00:02:22"],
        [48.73355, 2.50744, "00:01:58"],
        [48.70186, 2.68159, "00:05:00"],
        [48.67599, 2.72792, "00:01:26"],
        [48.56911, 2.75358, "00:03:40"],
        [48.39683, 2.97820, "00:05:43"],
        [48.37260, 3.05381, "00:01:23"],
        [48.25960, 3.28652, "00:04:59"],
        [48.11586, 3.44976, "00:04:50"],
        [47.98193, 3.67834, "00:04:54"],
        [47.97407, 3.69335, "00:00:18"],
        [47.85008, 3.92233, "00:04:58"],
        [47.68374, 4.07910, "00:04:54"],
        [47.48607, 4.15635, "00:05:30"],
        [47.34790, 4.24603, "00:04:15"],
        [47.29473, 4.27178, "00:01:35"],
        [47.14900, 4.34201, "00:03:45"],
        [46.99679, 4.45548, "00:04:30"],
        [46.94780, 4.48808, "00:01:25"],
        [46.76534, 4.50010, "00:04:44"],
        [46.61190, 4.60418, "00:04:39"],
        [46.43449, 4.67387, "00:04:30"],
        [46.37125, 4.67518, "00:01:48"],
        [46.28338, 4.77797, "00:02:45"],
        [46.06674, 4.84928, "00:06:32"],
        [45.90156, 4.87495, "00:04:20"],
        [45.89360, 4.87707, "00:00:13"],
        [45.86041, 4.90772, "00:01:02"],
        [45.84303, 5.01456, "00:02:05"],
        [45.72106, 5.07589, "00:03:25"],
        [45.66017, 5.07287, "00:01:35"],
        [45.46091, 5.04418, "00:05:40"],
        [45.19677, 4.91898, "00:06:35"],
        [45.15760, 4.92203, "00:00:58"],
        [44.99112, 4.97879, "00:04:05"],
        [44.68243, 4.93530, "00:08:20"],
        [44.49641, 4.77729, "00:05:14"],
        [44.37792, 4.73232, "00:03:00"],
        [44.30675, 4.70120, "00:01:55"],
        [44.16485, 4.73397, "00:03:50"],
        [43.97382, 4.73681, "00:05:30"],
        [43.92171, 4.78642, "00:03:00"],
        [43.80702, 5.04268, "00:11:00"],
        [43.68812, 5.19707, "00:04:00"],
        [43.54931, 5.32919, "00:05:00"],
        [43.45553, 5.31718, "00:04:00"],
        [43.42822, 5.32977, "00:04:00"],
        [43.35441, 5.35259, "00:05:00"],
        [43.30334, 5.38096, "00:06:00"]
    ];

    function parseDuration(timeStr) {
        const parts = timeStr.split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;
        return ((h * 3600) + (m * 60) + s) * 1000;
    }

    function getSimulatedPosition() {
        const now = Date.now();
        let timeElapsed = (now - START_TIME) * SPEED_MULTIPLIER;
        let currentSegment = 0;

        // On interprète la durée comme stockée sur le POINT D'ARRIVÉE
        // -> durée du segment (i -> i+1) = DATA_POINTS[i+1][2]
        while (currentSegment < DATA_POINTS.length - 1) {
            const segmentDuration = parseDuration(DATA_POINTS[currentSegment + 1][2]);

            if (timeElapsed < segmentDuration) {
                const startPt = DATA_POINTS[currentSegment];
                const endPt = DATA_POINTS[currentSegment + 1];

                const progress = segmentDuration > 0 ? (timeElapsed / segmentDuration) : 1;

                const lat = startPt[0] + (endPt[0] - startPt[0]) * progress;
                const lon = startPt[1] + (endPt[1] - startPt[1]) * progress;

                console.log(
                    `[FAKE GPS] segment=${currentSegment}, elapsed=${(timeElapsed / 1000).toFixed(1)}s, dur=${(segmentDuration / 1000).toFixed(1)}s, lat=${lat.toFixed(5)}, lon=${lon.toFixed(5)}`
                );

                return {
                    latitude: lat,
                    longitude: lon,
                    finished: false
                };
            }

            timeElapsed -= segmentDuration;
            currentSegment++;
        }

        const lastPt = DATA_POINTS[DATA_POINTS.length - 1];
        console.log("[FAKE GPS] Terminus atteint, position finale.");
        return {
            latitude: lastPt[0],
            longitude: lastPt[1],
            finished: true
        };
    }

    const mockGeoLocation = {
        getCurrentPosition: function (success, error, options) {
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
        watchPosition: function (success, error, options) {
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