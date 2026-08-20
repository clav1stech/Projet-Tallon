import { STATE, restoreSettings, saveSettings } from './state.js';
import { buildEffectiveRoute, computeDepartureTimestamp, computeSegmentIndexAndDistance, computeCurrentDelay, projectPositionOnRouteSegment, findNearestSegmentIndex } from './functions.js';
import { shouldAcceptAccuracy, evaluateTeleport, medianStepSpeed, noiseFloorKmh, filterSpeedSpike } from './tracking.js';
import { populateTrajetDropdown, renderStopCheckboxes, displayTimeline, updateInfo, updateTrackingWidget, updateLandscapeHUD, MAIN_ROUTES } from './ui.js';
import { geoErrorMessage, haversineDistance } from './geo.js';
import { loadDataset } from './csv.js';
import { buildCorridor, locateOnCorridor, formatPk } from './linearref.js';

let trackingInterval = null;

// La détection ne peut pas reposer sur le seul user-agent : dans une WebView
// hôte (Scriptable), l'UA peut ne pas contenir « iPhone », ce qui basculerait
// la page sur la mise en page non-iPhone (HUD surdimensionné) sur un iPhone.
// navigator.platform reste fiable dans WebKit quel que soit l'UA.
function isIPhoneDevice() {
    if (typeof navigator === 'undefined') return false;
    if (/iPhone|iPod/i.test(navigator.userAgent || '')) return true;
    return navigator.platform === 'iPhone' || navigator.platform === 'iPod touch';
}

function updateDebugBar(status) {
    const el = document.getElementById('debug-bar');
    if (!el) return;
    const ua = navigator.userAgent;
    let agentLabel;
    if (window.IS_SCRIPTABLE_BRIDGE || ua.includes('Scriptable'))               agentLabel = 'Scriptable';
    else if (/iPhone/i.test(ua))                                               agentLabel = 'iPhone Safari';
    else if (/iPad/i.test(ua))                                                 agentLabel = 'iPad Safari';
    else if (/Macintosh|Mac OS X/.test(ua) && !ua.includes('Mobile'))         agentLabel = 'Mac Safari';
    else                                                                        agentLabel = 'Autre';
    const fakeGps = window.FAKE_GPS_SPEED_MULTIPLIER
        ? `⚡ FakeGPS ×${window.FAKE_GPS_SPEED_MULTIPLIER}`
        : (typeof ENABLE_FAKE_GPS !== 'undefined' && !ENABLE_FAKE_GPS ? 'FakeGPS OFF' : '');
    el.innerHTML = `Agent: ${agentLabel} | Mode: ${STATE.locationMethod}${fakeGps ? ' | ' + fakeGps : ''}${status ? ' | ' + status : ''}<br><small style="opacity:0.6">${ua}</small>`;
}

const handleStopsChange = async (stopIds) => {
    STATE.selectedStopIds = stopIds;
    saveSettings();
    await loadSelectedPatternRoute();
    displayTimeline();
};

// Charge masterRoutes.normalized.json et servicePatterns.json
async function loadCoreData() {
    try {
        const [masterRes, patternsRes] = await Promise.all([
            fetch('data/masterRoutes.normalized.json'),
            fetch('data/servicePatterns.json')
        ]);

        if (!masterRes.ok || !patternsRes.ok) {
            throw new Error('Erreur HTTP sur masterRoutes ou servicePatterns');
        }

        const masterData = await masterRes.json();
        const patternsData = await patternsRes.json();

        // Schéma v3 : dictionnaire global de points + tableau de trajets (sans dénormalisation)
        STATE.points = masterData.points || {};
        STATE.trajets = masterData.trajets || [];
        STATE.servicePatterns = patternsData.servicePatterns || [];
    } catch (e) {
        console.error('loadCoreData error:', e);
        updateInfo('Erreur lors du chargement des données de base (masterRoutes / servicePatterns).');
        STATE.points = {};
        STATE.trajets = [];
        STATE.servicePatterns = [];
    }
}

// Corridor PK ferroviaire (ENRICHISSEMENT optionnel) : si le dataset décrit
// par data/datasets/rail-pk.json est disponible, un PK précis est affiché en
// plus des points nommés. Tant que le CSV n'est pas branché, l'absence du
// fichier est un no-op silencieux : aucun impact sur le mode rail existant.
async function loadRailPkCorridor() {
    try {
        const ds = await loadDataset('data/datasets/rail-pk.json');
        STATE.railCorridor = buildCorridor(ds.points);
        STATE.railCorridorIndex = null;
        console.log(`[PK] Corridor ferroviaire chargé : ${STATE.railCorridor.points.length} points (PK ${STATE.railCorridor.pkStart} → ${STATE.railCorridor.pkEnd})`);
    } catch (e) {
        STATE.railCorridor = null;
        console.info(`[PK] Corridor ferroviaire indisponible (${e.message}) — affichage PK désactivé.`);
    }
}

// Bridge de communication pour Scriptable
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SNCF_GPS_BRIDGE') {
        window.IS_SCRIPTABLE_BRIDGE = true;
        if (STATE.locationMethod !== 'sncf') {
            STATE.locationMethod = 'sncf';
            const locationToggle = document.getElementById('location-mode-toggle');
            if (locationToggle) { locationToggle.checked = true; }
            const locationLabel = document.getElementById('location-mode-label');
            if (locationLabel) { locationLabel.textContent = 'WiFi SNCF (Bridge)'; }
            updateDebugBar('Bridge Auto-Activated');
        }
        showPosition({
            coords: {
                latitude: e.data.coords.latitude,
                longitude: e.data.coords.longitude,
                accuracy: e.data.coords.accuracy,
                speed: e.data.coords.speed
            },
            timestamp: e.data.timestamp
        });
    }
});

// Chargement et initialisation DOM
document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.toggle('iphone-device', isIPhoneDevice());
    document.body.classList.toggle('non-iphone-device', !isIPhoneDevice());

    restoreSettings();

    // Mode de localisation : piloté par la checkbox, pas par l'user-agent
    const locationToggle = document.getElementById('location-mode-toggle');
    const locationModeLabel = document.getElementById('location-mode-label');

    const applyLocationMode = () => {
        STATE.locationMethod = locationToggle.checked ? 'sncf' : 'geo';
        // FakeGeoSim prend le dessus sur tout autre mode (dev uniquement)
        if (window.FAKE_GPS_SPEED_MULTIPLIER) STATE.locationMethod = 'geo';
        if (locationModeLabel) locationModeLabel.textContent = STATE.locationMethod === 'sncf' ? 'WiFi SNCF' : 'GPS natif';
        updateDebugBar();
    };

    if (locationToggle) locationToggle.addEventListener('change', applyLocationMode);
    applyLocationMode();

    // Initialisation UI immédiate (MAIN_ROUTES est statique, pas besoin du fetch)
    populateTrajetDropdown();

    const routeSelect = document.getElementById('routeSelect');
    const departureInput = document.getElementById('departure-time');
    const globalDeltaInput = document.getElementById('global-delta');
    const deltaMinus = document.getElementById('delta-minus');
    const deltaPlus = document.getElementById('delta-plus');

    if (routeSelect) {
        routeSelect.value = STATE.selectedMainRouteKey || '';
    }
    renderStopCheckboxes(STATE.selectedMainRouteKey, STATE.selectedStopIds, handleStopsChange);

    await loadCoreData();

    // Chargement non bloquant : le PK est un enrichissement, pas un prérequis.
    loadRailPkCorridor();
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

    const trajet = (STATE.trajets || []).find(t => t.id === mainRouteCfg.masterRouteId);
    const points = (trajet?.points || []).map(pt => ({ id: pt.id }));

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
            STATE.points,
            STATE.trajets,
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
        STATE.lastTrustedPosition = null;
        STATE.gpsRecoveryMode = false;
        STATE.teleportRejections = 0;
        STATE.lastAcceptedFixMs = 0;
        STATE.railCorridorIndex = null;
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

async function fetchSncfPosition() {
    if (window.IS_SCRIPTABLE_BRIDGE || navigator.userAgent.includes('Scriptable')) {
        updateDebugBar('Bridge Scriptable OK');
        updateInfo('Synchronisation WiFi SNCF via Scriptable active');
        return;
    }
    try {
        const response = await fetch('https://wifi.sncf/router/api/train/gps', { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('API injoignable');
        const data = await response.json();
        if (data.success) {
            const speedKmh = Number.isFinite(Number(data.speed)) ? Number(data.speed) * 3.6 : undefined;
            updateDebugBar('WiFi SNCF OK');
            showPosition({ coords: { latitude: data.latitude, longitude: data.longitude, accuracy: 15, speed: speedKmh }, timestamp: data.timestamp ? data.timestamp * 1000 : Date.now() });
            return;
        }
        throw new Error('Données invalides');
    } catch (e) {
        STATE.locationMethod = 'geo';
        updateDebugBar(`SNCF KO (${e.message}) → GPS`);
        updateInfo(`WiFi SNCF indisponible (${e.message}), bascule sur GPS natif.`);
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition, showError, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
        }
    }
}

function processCurrentPosition() {
    if (STATE.locationMethod === 'sncf') {
        fetchSncfPosition();
    } else if (STATE.locationMethod === 'geo') {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition, showError, {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            });
        } else {
            updateInfo("La géolocalisation n'est pas supportée par ce navigateur.");
        }
    }

    // Détection de perte GPS : injection de vitesse non fiable dans l'historique
    if (STATE.lastGpsUpdateMs > 0 && STATE.departureTimestamp) {
        const timeSinceLastGps = Date.now() - STATE.lastGpsUpdateMs;
        if (timeSinceLastGps > 15000 && timeSinceLastGps < 300000) {
            const lastEntry = STATE.speedHistory.length > 0 ? STATE.speedHistory[STATE.speedHistory.length - 1] : null;
            const lastSpeed = lastEntry ? lastEntry.v : 0;
            STATE.speedHistory.push({ v: lastSpeed, reliable: false });
            if (STATE.speedHistory.length > 1800) STATE.speedHistory.shift();

            // Mettre à jour le HUD avec l'indicateur de signal perdu
            const lastPos = STATE.lastPositions.length > 0 ? STATE.lastPositions[STATE.lastPositions.length - 1] : null;
            updateLandscapeHUD(
                STATE.lastSegmentIndex ?? 0,
                lastSpeed,
                STATE.currentDelay ?? 0,
                lastPos ? lastPos.lat : 0,
                lastPos ? lastPos.lon : 0,
                false
            );
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

    STATE.lastGpsUpdateMs = Date.now();

    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;
    const accuracyMeters = Number(position.coords.accuracy);
    const positionTimestamp = Date.now();

    // Filtre de précision : rejeter les rebonds imprécis (positionnement
    // cellulaire post-tunnel), sauf en mode dégradé (disette de fix prolongée).
    if (!shouldAcceptAccuracy(accuracyMeters, STATE.lastAcceptedFixMs || 0, positionTimestamp)) {
        console.warn(`[GPS] Fix rejeté (précision ±${Math.round(accuracyMeters)} m)`);
        return;
    }

    // Guard anti-téléportation avec récupération : les positions physiquement
    // impossibles (> 2000 km/h) sont ignorées, mais si elles persistent
    // (app suspendue par iOS puis réveillée ailleurs), on ré-ancre le tracking.
    const teleportVerdict = evaluateTeleport(
        STATE.lastTrustedPosition,
        userLat, userLon,
        positionTimestamp,
        STATE.teleportRejections || 0
    );
    STATE.teleportRejections = teleportVerdict.rejections;
    if (!teleportVerdict.accept) {
        STATE.gpsRecoveryMode = true;
        console.warn('[GPS] Téléportation ignorée');
        return;
    }
    STATE.gpsRecoveryMode = false;
    if (teleportVerdict.reseeded) {
        console.warn('[GPS] Position divergente persistante → ré-ancrage du tracking');
        STATE.lastSegmentIndex = null;
        STATE.lastPositions = [];
    }
    STATE.lastTrustedPosition = { lat: userLat, lon: userLon, ts: positionTimestamp };
    STATE.lastAcceptedFixMs = positionTimestamp;

    // Seed géographique : au premier fix GPS (ou après ré-ancrage), trouver le
    // segment le plus proche par projection pour éviter un accrochage faux.
    if (STATE.lastSegmentIndex === null) {
        STATE.lastSegmentIndex = findNearestSegmentIndex(STATE.currentRoute, userLat, userLon);
    }
    const reportedSpeed = Number(position.coords.speed);
    const hasDirectSncfSpeed = STATE.locationMethod === 'sncf' && Number.isFinite(reportedSpeed) && reportedSpeed >= 0;

    // Historique de positions pour vitesse lissée (10 s à 1 pt/s)
    STATE.lastPositions.push({ lat: userLat, lon: userLon, ts: positionTimestamp });
    if (STATE.lastPositions.length > 10) {
        STATE.lastPositions.shift();
    }

    // Vitesse lissée : médiane des vitesses instantanées entre chaque pas consécutif
    let currentSpeed = hasDirectSncfSpeed ? reportedSpeed : 0;
    if (!hasDirectSncfSpeed && STATE.lastPositions.length >= 2) {
        currentSpeed = medianStepSpeed(STATE.lastPositions);

        // Plancher de bruit : à l'arrêt en gare, le jitter GPS produit une
        // vitesse fantôme (±30 m sur 10 s ≈ 11 km/h). En dessous du plancher,
        // la vitesse est considérée nulle.
        const first = STATE.lastPositions[0];
        const last = STATE.lastPositions[STATE.lastPositions.length - 1];
        const windowSeconds = (last.ts - first.ts) / 1000;
        if (currentSpeed < noiseFloorKmh(accuracyMeters, windowSeconds)) {
            currentSpeed = 0;
        }
    }

    // Correction vitesse si simulation GPS active (positions avancent × SPEED_MULTIPLIER)
    if (window.FAKE_GPS_SPEED_MULTIPLIER) {
        currentSpeed = currentSpeed / window.FAKE_GPS_SPEED_MULTIPLIER;
    }

    // Filtre de cohérence physique pour éviter les pics GPS sur le graphique
    const lastEntry = STATE.speedHistory.length > 0 ? STATE.speedHistory[STATE.speedHistory.length - 1] : null;
    const prevSpeed = lastEntry ? lastEntry.v : currentSpeed;
    currentSpeed = filterSpeedSpike(prevSpeed, currentSpeed);
    currentSpeed = Math.max(0, Math.min(350, currentSpeed));

    // Historique de vitesse pour le sparkline
    STATE.speedHistory.push({ v: currentSpeed, reliable: true });
    if (STATE.speedHistory.length > 1800) {
        STATE.speedHistory.shift();
    }

    // ✅ Passer lastSegmentIndex pour respecter le sens de circulation
    let {
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

    // 🔒 Garde-fou unidirectionnel : l'index de segment ne peut jamais reculer.
    // Les distances sont reprojetées sur le segment retenu, sinon le calcul de
    // retard utiliserait une distance mesurée sur un autre segment.
    if (STATE.lastSegmentIndex !== null && segmentIndex < STATE.lastSegmentIndex) {
        segmentIndex = STATE.lastSegmentIndex;
        const projection = projectPositionOnRouteSegment(STATE.currentRoute, segmentIndex, userLat, userLon);
        distanceFromSegmentStart = projection.distanceFromSegmentStart;
        distanceToNextPointKm = projection.distanceToNextPointKm;
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
    let currentDelayMs = computeCurrentDelay(
        STATE.currentRoute,
        segmentIndex,
        distanceFromSegmentStart,
        STATE.departureTimestamp,
        now
    );

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

    // Gel du retard à l'arrivée : une fois le terminus franchi (y compris en
    // avance), le retard affiché est celui constaté au passage — sinon il
    // croîtrait indéfiniment tant que le train reste à quai.
    const terminusPoint = STATE.currentRoute[lastRouteIdx];
    if (terminusPoint && STATE.passedPoints[terminusPoint.id] != null) {
        currentDelayMs = STATE.passedPoints[terminusPoint.id];
    }
    STATE.currentDelay = currentDelayMs;

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

    const speedReliable = hasDirectSncfSpeed || (STATE.locationMethod === 'geo' && STATE.lastPositions.length >= 2);
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

    // Enrichissement PK (informatif uniquement — aucun couplage avec le calcul
    // de retard) : PK interpolé sur le corridor ferroviaire si disponible.
    if (STATE.railCorridor) {
        const loc = locateOnCorridor(STATE.railCorridor, userLat, userLon, STATE.railCorridorIndex, accuracyMeters);
        if (loc) {
            STATE.railCorridorIndex = loc.index;
            infoHtml += ` PK ${formatPk(loc.pk)}${loc.line ? ` (ligne ${loc.line})` : ''}.`;
        }
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
