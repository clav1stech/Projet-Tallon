import { STATE, restoreSettings, saveSettings } from './state.js';
import { buildEffectiveRoute, computeDepartureTimestamp, computeSegmentIndexAndDistance, computeCurrentDelay } from './functions.js';
import { populateTrajetDropdown, renderStopCheckboxes, setupLocationMethodListener, displayTimeline, updateInfo, updateTrackingWidget, updateLandscapeHUD, MAIN_ROUTES } from './ui.js';
import { geoErrorMessage, haversineDistance } from './geo.js';

let trackingInterval = null;
const handleStopsChange = async (stopIds) => {
    STATE.selectedStopIds = stopIds;
    saveSettings();
    await loadSelectedPatternRoute();
    displayTimeline();
};

// Charge masterRoutes.json et servicePatterns.json
async function loadCoreData() {
    try {
        const [masterRes, patternsRes] = await Promise.all([
            fetch('data/masterRoutes.json'),
            fetch('data/servicePatterns.json')
        ]);

        if (!masterRes.ok || !patternsRes.ok) {
            throw new Error('Erreur HTTP sur masterRoutes ou servicePatterns');
        }

        const masterData = await masterRes.json();
        const patternsData = await patternsRes.json();

        STATE.masterRoutes = masterData.masterRoutes || [];
        STATE.servicePatterns = patternsData.servicePatterns || [];
    } catch (e) {
        console.error('loadCoreData error:', e);
        updateInfo('Erreur lors du chargement des données de base (masterRoutes / servicePatterns).');
        STATE.masterRoutes = [];
        STATE.servicePatterns = [];
    }
}

// Chargement et initialisation DOM
document.addEventListener('DOMContentLoaded', async () => {
    restoreSettings();

    await loadCoreData();

    populateTrajetDropdown();
    setupLocationMethodListener();

    const routeSelect = document.getElementById('routeSelect');
    const departureInput = document.getElementById('departure-time');
    const globalDeltaInput = document.getElementById('global-delta');
    const deltaMinus = document.getElementById('delta-minus');
    const deltaPlus = document.getElementById('delta-plus');

    // Initialisation des champs
    if (routeSelect) {
        routeSelect.value = STATE.selectedMainRouteKey || '';
    }
    renderStopCheckboxes(STATE.selectedMainRouteKey, STATE.selectedStopIds, handleStopsChange);
    if (departureInput) {
        departureInput.value = STATE.departureTime || '';
    }
    if (globalDeltaInput) {
        // ✅ Initialiser le champ ΔT avec la valeur restaurée
        globalDeltaInput.value = Math.round((STATE.globalDeltaSeconds || 0) / 60).toString();
    }

    // Listener sélection de route
    if (routeSelect) {
        routeSelect.addEventListener('change', async () => {
            STATE.selectedMainRouteKey = routeSelect.value || '';
            STATE.selectedStopIds = [];
            saveSettings();
            renderStopCheckboxes(STATE.selectedMainRouteKey, STATE.selectedStopIds, handleStopsChange);
            await loadSelectedPatternRoute();
            displayTimeline();
        });
    }

    // Listener heure de départ
    if (departureInput) {
        departureInput.addEventListener('change', () => {
            STATE.departureTime = departureInput.value || '';
            if (STATE.departureTime) {
                STATE.departureTimestamp = computeDepartureTimestamp(STATE.departureTime);
            } else {
                STATE.departureTimestamp = null;
            }
            saveSettings();
            displayTimeline();
        });
    }

    // ✅ Listener ΔT global
    if (globalDeltaInput) {
        globalDeltaInput.addEventListener('change', async () => {
            const raw = globalDeltaInput.value;
            const value = Number(raw);
            const minutes = Number.isFinite(value) ? value : 0;
            STATE.globalDeltaSeconds = minutes * 60;
            saveSettings();

            // Reconstruire la route avec le nouveau ΔT
            await loadSelectedPatternRoute();
            displayTimeline();
        });
    }

    const clampDelta = (minutes) => {
        const min = Number(globalDeltaInput?.min ?? -30);
        const max = Number(globalDeltaInput?.max ?? 30);
        return Math.max(min, Math.min(max, minutes));
    };

    const adjustDelta = async (delta) => {
        if (!globalDeltaInput) return;
        const currentMinutes = Number(globalDeltaInput.value) || 0;
        const nextMinutes = clampDelta(currentMinutes + delta);
        globalDeltaInput.value = nextMinutes.toString();
        STATE.globalDeltaSeconds = nextMinutes * 60;
        saveSettings();
        await loadSelectedPatternRoute();
        displayTimeline();
    };

    if (deltaMinus) {
        deltaMinus.addEventListener('click', () => adjustDelta(-1));
    }
    if (deltaPlus) {
        deltaPlus.addEventListener('click', () => adjustDelta(1));
    }

    // Chargement initial de la route sélectionnée
    if (STATE.selectedMainRouteKey) {
        await loadSelectedPatternRoute();
    }

    if (STATE.departureTime) {
        STATE.departureTimestamp = computeDepartureTimestamp(STATE.departureTime);
    }

    displayTimeline();

    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', startTracking);
    }

    const controlsPanel = document.querySelector('.controls-panel');
    if (controlsPanel) {
        let touchStartY = null;
        const minSwipe = 40;

        controlsPanel.addEventListener('touchstart', (event) => {
            if (!document.body.classList.contains('tracking-active')) {
                return;
            }
            touchStartY = event.touches[0].clientY;
        }, { passive: true });

        controlsPanel.addEventListener('touchend', (event) => {
            if (touchStartY === null) {
                return;
            }
            const endY = event.changedTouches[0].clientY;
            const deltaY = endY - touchStartY;

            if (Math.abs(deltaY) >= minSwipe) {
                if (deltaY > 0) {
                    document.body.classList.add('show-settings');
                } else {
                    document.body.classList.remove('show-settings');
                }
            }

            touchStartY = null;
        });
    }
});

function getMainRouteConfig() {
    return MAIN_ROUTES[STATE.selectedMainRouteKey] || null;
}

function orderSelectedStops(mainRouteCfg) {
    if (!mainRouteCfg) return [];

    const master = (STATE.masterRoutes || []).find(m => m.id === mainRouteCfg.masterRouteId);
    const points = master?.points || [];

    const allowedSet = new Set((mainRouteCfg.stopOptions || []).map(s => s.id));
    const startIndex = points.findIndex(p => p.id === mainRouteCfg.startPointId);
    const endIndex = points.findIndex(p => p.id === mainRouteCfg.endPointId);
    if (startIndex === -1 || endIndex === -1) return [];

    const minIdx = Math.min(startIndex, endIndex);
    const maxIdx = Math.max(startIndex, endIndex);
    const sliceIds = points.slice(minIdx, maxIdx + 1).map(p => p.id);

    const selectedSet = new Set(
        (STATE.selectedStopIds || []).filter(id => allowedSet.has(id))
    );

    return sliceIds.filter(id => selectedSet.has(id) && id !== mainRouteCfg.startPointId && id !== mainRouteCfg.endPointId);
}

function buildPatternFromSelection() {
    const mainRouteCfg = getMainRouteConfig();
    if (!mainRouteCfg) return null;

    const orderedStops = orderSelectedStops(mainRouteCfg);
    const stops = [
        mainRouteCfg.startPointId,
        ...orderedStops,
        mainRouteCfg.endPointId
    ];

    const patternId = `CUSTOM_${mainRouteCfg.endPointId}_${orderedStops.join('_') || 'DIRECT'}`;

    return {
        id: patternId,
        label: mainRouteCfg.label,
        masterRouteId: mainRouteCfg.masterRouteId,
        startPointId: mainRouteCfg.startPointId,
        endPointId: mainRouteCfg.endPointId,
        stops,
        deltaSeconds: 0
    };
}

// Construit STATE.currentRoute à partir du pattern sélectionné
async function loadSelectedPatternRoute() {
    const pattern = buildPatternFromSelection();
    if (!pattern) {
        STATE.currentRoute = [];
        STATE.direction = 'SUD';
        displayTimeline();
        return;
    }

    try {
        const effectiveRoute = buildEffectiveRoute(
            pattern.id,
            STATE.globalDeltaSeconds,
            STATE.masterRoutes,
            [pattern]
        );
        STATE.currentRoute = effectiveRoute.points || [];
        STATE.direction = effectiveRoute.direction || 'SUD';
        STATE.selectedPatternId = pattern.id;

        // ✅ DEBUG : afficher le nombre de points générés
        console.log(`[loadSelectedPatternRoute] Pattern: ${pattern.id}, Points générés: ${STATE.currentRoute.length}`);
        console.log('[loadSelectedPatternRoute] Premier point:', STATE.currentRoute[0]?.name);
        console.log('[loadSelectedPatternRoute] Dernier point:', STATE.currentRoute[STATE.currentRoute.length - 1]?.name);

        // pointsDePassage reste un champ dérivé/legacy : on garde la compat UI
        STATE.pointsDePassage = STATE.currentRoute;

        // Reset des infos de tracking liées aux segments
        STATE.lastSegmentIndex = null;
        STATE.passedPoints = {};
    } catch (e) {
        console.error(e);
        updateInfo("Erreur lors de la construction de la route pour le pattern sélectionné.");
        STATE.currentRoute = [];
    }
}

function startTracking() {
    if (!STATE.departureTime) {
        alert("Please select a departure time.");
        return;
    }
    if (!STATE.currentRoute.length) {
        alert("Please select a route.");
        return;
    }

    // Timestamp de départ effectif (basé sur l'heure saisie)
    STATE.departureTimestamp = computeDepartureTimestamp(STATE.departureTime);

    displayTimeline();
    document.body.classList.add('tracking-active');
    document.body.classList.remove('show-settings');

    // Démarre le tracking une seule fois
    if (!trackingInterval) {
        trackingInterval = setInterval(processCurrentPosition, 1000);
        processCurrentPosition(); // Exécution immédiate
    }
}

function processCurrentPosition() {
    if (STATE.locationMethod === 'geo') {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition, showError, {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            });
        } else {
            updateInfo("La géolocalisation n'est pas supportée par ce navigateur.");
        }
    } else {
        const manualLat = parseFloat(STATE.manualLat);
        const manualLon = parseFloat(STATE.manualLon);
        if (!isNaN(manualLat) && !isNaN(manualLon)) {
            showPosition({ coords: { latitude: manualLat, longitude: manualLon, accuracy: 0 } });
        } else {
            updateInfo("Veuillez saisir des coordonnées valides.");
        }
    }
}

function showError(error) {
    updateInfo(geoErrorMessage(error));
}

function showPosition(position) {
    if (!STATE.currentRoute.length || !STATE.departureTimestamp) {
        updateInfo("Route ou heure de départ non initialisée.");
        return;
    }

    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;
    const accuracyMeters = Number(position.coords.accuracy);
    const positionTimestamp = Date.now();

    // Historique de positions pour vitesse lissée (max 4 entrées)
    STATE.lastPositions.push({ lat: userLat, lon: userLon, ts: positionTimestamp });
    if (STATE.lastPositions.length > 4) {
        STATE.lastPositions.shift();
    }

    // Calcul de la vitesse lissée entre la position la plus ancienne et la position actuelle
    let currentSpeed = 0;
    if (STATE.lastPositions.length >= 2) {
        const oldest = STATE.lastPositions[0];
        const distanceKm = haversineDistance(oldest.lat, oldest.lon, userLat, userLon);
        const elapsedHours = (positionTimestamp - oldest.ts) / 3_600_000;
        if (elapsedHours > 0) {
            currentSpeed = distanceKm / elapsedHours;
        }
    }

    // Historique de vitesse pour le sparkline
    STATE.speedHistory.push(currentSpeed);
    if (STATE.speedHistory.length > 1800) {
        STATE.speedHistory.shift();
    }

    // ✅ Passer lastSegmentIndex pour respecter le sens de circulation
    const {
        segmentIndex,
        distanceFromSegmentStart,
        distanceToNextPointKm
    } = computeSegmentIndexAndDistance(
        STATE.currentRoute, 
        userLat, 
        userLon, 
        STATE.lastSegmentIndex,
        Number.isFinite(accuracyMeters) ? accuracyMeters : null,
        STATE.direction
    );

    if (segmentIndex === null || segmentIndex < 0) {
        let infoHtml = `<strong>Position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}.`;
        if (Number.isFinite(accuracyMeters) && accuracyMeters > 0) {
            infoHtml += ` (±${Math.round(accuracyMeters)} m)`;
        }
        infoHtml += " Position actuelle hors de la route prévue.";
        updateInfo(infoHtml);
        return;
    }

    const now = Date.now();

    // ✅ Enregistrer les points passés quand on avance
    if (STATE.lastSegmentIndex !== null && segmentIndex > STATE.lastSegmentIndex) {
        for (let i = STATE.lastSegmentIndex + 1; i <= segmentIndex; i++) {
            const passedPoint = STATE.currentRoute[i];
            if (passedPoint && !STATE.passedPoints[passedPoint.id]) {
                // Calculer le retard au moment du passage
                let cumSeconds = 0;
                for (let j = 0; j < i; j++) {
                    cumSeconds += Number(STATE.currentRoute[j].durationEffective ?? STATE.currentRoute[j].baseDurationToNext ?? 0);
                }
                const theoTimestamp = STATE.departureTimestamp + cumSeconds * 1000;
                STATE.passedPoints[passedPoint.id] = now - theoTimestamp;
                STATE.passedPointMarkers.push({ name: passedPoint.name, ts: now });

                console.log(`[Passage] ✅ Point franchi: ${passedPoint.name}, retard: ${Math.round((now - theoTimestamp) / 1000)}s`);
            }
        }
    }

    // ✅ Mettre à jour le dernier segment validé (ne peut que croître)
    if (segmentIndex > (STATE.lastSegmentIndex ?? -1)) {
        STATE.lastSegmentIndex = segmentIndex;
    }

    // Calcul du retard
    const currentDelayMs = computeCurrentDelay(
        STATE.currentRoute,
        segmentIndex,
        distanceFromSegmentStart,
        STATE.departureTimestamp,
        now
    );
    STATE.currentDelay = currentDelayMs;

    // Cas d'arrivée à destination : si on est sur le dernier segment et très proche du terminus,
    // considérer la destination comme franchie et afficher le terminus comme point actif.
    const lastRouteIdx = STATE.currentRoute.length - 1;
    let displayIdx = segmentIndex;
    if (segmentIndex === lastRouteIdx - 1 && distanceToNextPointKm < 0.2) {
        displayIdx = lastRouteIdx;
        // Enregistrer le passage au terminus si pas encore fait
        const destPoint = STATE.currentRoute[lastRouteIdx];
        if (destPoint && !STATE.passedPoints[destPoint.id]) {
            let cumSeconds = 0;
            for (let j = 0; j < lastRouteIdx; j++) {
                cumSeconds += Number(STATE.currentRoute[j].durationEffective ?? STATE.currentRoute[j].baseDurationToNext ?? 0);
            }
            STATE.passedPoints[destPoint.id] = now - (STATE.departureTimestamp + cumSeconds * 1000);
        }
    }

    // Points pour l'affichage
    const lastPassedPoint = STATE.currentRoute[displayIdx] || null;
    const nextPoint = displayIdx < lastRouteIdx ? STATE.currentRoute[displayIdx + 1] : null;

    // Distance depuis le dernier point passé
    let lastPointDistanceKm = 0;
    if (lastPassedPoint && typeof lastPassedPoint.lat === 'number') {
        lastPointDistanceKm = haversineDistance(
            lastPassedPoint.lat, lastPassedPoint.lon,
            userLat, userLon
        );
    }

    displayTimeline(displayIdx);

    updateTrackingWidget(
        lastPassedPoint,
        nextPoint,
        lastPointDistanceKm,
        distanceToNextPointKm
    );

    const speedReliable = STATE.locationMethod === 'geo' && STATE.lastPositions.length >= 2;
    updateLandscapeHUD(displayIdx, currentSpeed, currentDelayMs, userLat, userLon, speedReliable);

    let infoHtml = `<strong>Position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}.`;
    if (Number.isFinite(accuracyMeters) && accuracyMeters > 0) {
        infoHtml += ` (±${Math.round(accuracyMeters)} m)`;
    }
    if (nextPoint) {
        infoHtml += ` Prochain : ${nextPoint.name} (${distanceToNextPointKm.toFixed(2)} km).`;
    } else {
        infoHtml += ` Arrivée à ${lastPassedPoint?.name ?? 'destination'}.`;
    }
    updateInfo(infoHtml);
}

const startBtn = document.getElementById('start-btn');
if (startBtn && typeof window !== 'undefined') {
    startBtn.addEventListener('click', () => {
        if (typeof window.resetFakeGpsStartTime === 'function') {
            window.resetFakeGpsStartTime();
        }
    });
}
