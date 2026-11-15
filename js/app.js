import { STATE, restoreSettings, saveSettings } from './state.js';
import { buildServiceSummary, createTripConfig } from './trip-config.js';
import { ingestFix, recordSignalLossTick, getLocationStatus } from './tracking-session.js';
import {
    adoptLocationMethod, applyDraft, buildDraftPlan, getHomeAction, launchSession,
    revertDraft, setDraft, showView, stopSession
} from './train-controller.js';
import {
    populateTrajetDropdown, renderStopCheckboxes, displayTimeline, updateInfo, updateTrackingWidget,
    updateLandscapeHUD, renderServiceSummary, renderHomeActions
} from './ui.js';
import { geoErrorMessage } from './geo.js';
import { loadDataset } from './csv.js';
import { buildCorridor, locateOnCorridor, formatPk } from './linearref.js';
import { DELTA_MAX_MINUTES, DELTA_MIN_MINUTES, GEOLOCATION_OPTIONS, TRACKING_TICK_MS } from './train-config.js';

// Boucle d'acquisition : créée au lancement d'une session, détruite à sa
// clôture. Ni la navigation ni une reconfiguration n'y touchent.
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


// ───────────────────────── Rendu ─────────────────────────

const el = (id) => document.getElementById(id);

/** Aperçu de desserte et actions de l'accueil, depuis la configuration provisoire. */
function renderHome() {
    renderServiceSummary(buildServiceSummary(buildDraftPlan(STATE)));
    renderHomeActions(getHomeAction(STATE));
}

/** Aligne les champs du formulaire sur la configuration provisoire. */
function syncFormFromDraft() {
    const draft = STATE.draftConfig;
    const routeSelect = el('routeSelect');
    if (routeSelect) routeSelect.value = draft.mainRouteKey;
    renderStopCheckboxes(draft.mainRouteKey, draft.stopIds, (stopIds) => updateDraft({ stopIds }));
    const departureInput = el('departure-time');
    if (departureInput && departureInput.value !== draft.departureTime) departureInput.value = draft.departureTime;
    const deltaInput = el('global-delta');
    if (deltaInput) deltaInput.value = Math.round(draft.globalDeltaSeconds / 60).toString();
    syncLocationControls();
}

function syncLocationControls(bridge = false) {
    const toggle = el('location-mode-toggle');
    const label = el('location-mode-label');
    const sncf = STATE.draftConfig.locationMethod === 'sncf';
    if (toggle) toggle.checked = sncf;
    if (label) label.textContent = sncf ? (bridge ? 'WiFi SNCF (Bridge)' : 'WiFi SNCF') : 'GPS natif';
}

function updateDraft(patch) {
    setDraft(STATE, patch);
    saveSettings();
    renderHome();
}

/**
 * Redessine le suivi depuis l'état, sans attendre de fix : appelé après
 * chaque position, mais aussi au retour des réglages, après une
 * reconfiguration et lors d'une rotation.
 */
function renderTracking() {
    if (!STATE.session.active) {
        displayTimeline();
        return;
    }
    const snapshot = STATE.trackingSnapshot;
    if (!snapshot) {
        // Trajet connu, position pas encore accrochée : le suivi montre déjà
        // le parcours et l'heure d'arrivée théorique.
        displayTimeline();
        if (STATE.view === 'tracking') updateLandscapeHUD(0, 0, 0, undefined, undefined, false);
        return;
    }

    const route = STATE.currentRoute;
    const idx = snapshot.displayIdx;
    displayTimeline(idx, snapshot.progress);
    updateTrackingWidget(
        route[idx] || null,
        idx < route.length - 1 ? route[idx + 1] : null,
        snapshot.lastPointDistanceKm,
        snapshot.progress.distanceToNextPointKm
    );
    // Le HUD mesure son conteneur : inutile et faux tant qu'il est masqué.
    if (STATE.view === 'tracking') {
        const signalLost = getLocationStatus(STATE).signal === 'lost';
        updateLandscapeHUD(idx, snapshot.speedKmh, snapshot.currentDelayMs, snapshot.lat, snapshot.lon,
            snapshot.speedReliable && !signalLost, snapshot.progress);
    }
}

/** Reflète l'état de navigation et de session dans la page. */
function syncView() {
    document.body.classList.toggle('tracking-active', STATE.view === 'tracking');
    document.body.classList.toggle('session-active', STATE.session.active);
    renderHome();
    renderTracking();
    updateDebugBar();
}

// ───────────────────────── Session ─────────────────────────

// FakeGeoSim prend le dessus sur tout autre mode (dev uniquement).
function enforceSimulatedSource() {
    if (window.FAKE_GPS_SPEED_MULTIPLIER) STATE.locationMethod = 'geo';
}

function startTrackingLoop() {
    if (trackingInterval) return;
    trackingInterval = setInterval(processCurrentPosition, TRACKING_TICK_MS);
    processCurrentPosition();
}

function stopTrackingLoop() {
    if (!trackingInterval) return;
    clearInterval(trackingInterval);
    trackingInterval = null;
}

function onPrimaryAction() {
    const action = getHomeAction(STATE);
    if (action.mode === 'launch') {
        if (!launchSession(STATE).ok) { renderHome(); return; }
        if (typeof window.resetFakeGpsStartTime === 'function') window.resetFakeGpsStartTime();
        enforceSimulatedSource();
        startTrackingLoop();
    } else if (action.mode === 'apply') {
        const result = applyDraft(STATE);
        if (!result.ok) { renderHome(); return; }
        enforceSimulatedSource();
        if (result.change === 'route') updateInfo('Trajet resynchronisé, historique conservé.');
        else if (result.change === 'schedule') updateInfo('Horaires recalculés, historique conservé.');
    } else {
        showView(STATE, 'tracking');
    }
    syncView();
}

function onSecondaryAction() {
    const action = getHomeAction(STATE);
    if (action.secondary === 'cancel') {
        revertDraft(STATE);
        saveSettings();
        syncFormFromDraft();
        renderHome();
    } else if (action.secondary === 'end') {
        stopTrackingLoop();
        stopSession(STATE);
        syncView();
    }
}

// Bridge de communication pour Scriptable
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SNCF_GPS_BRIDGE') {
        window.IS_SCRIPTABLE_BRIDGE = true;
        if (STATE.locationMethod !== 'sncf') {
            adoptLocationMethod(STATE, 'sncf');
            syncLocationControls(true);
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
    const locationToggle = el('location-mode-toggle');
    STATE.draftConfig = createTripConfig({
        ...STATE.draftConfig,
        locationMethod: locationToggle && locationToggle.checked ? 'sncf' : 'geo'
    });

    // MAIN_ROUTES est statique : le formulaire n'attend pas le chargement des données.
    populateTrajetDropdown(STATE.draftConfig.mainRouteKey);
    syncFormFromDraft();
    updateDebugBar();

    await loadCoreData();

    // Chargement non bloquant : le PK est un enrichissement, pas un prérequis.
    loadRailPkCorridor();

    // Chaque champ ne modifie que la configuration provisoire : la session en
    // cours n'en voit rien avant « Appliquer ».
    const routeSelect = el('routeSelect');
    if (routeSelect) {
        routeSelect.addEventListener('change', () => {
            updateDraft({ mainRouteKey: routeSelect.value || '' });
            renderStopCheckboxes(STATE.draftConfig.mainRouteKey, STATE.draftConfig.stopIds, (stopIds) => updateDraft({ stopIds }));
        });
    }

    const departureInput = el('departure-time');
    if (departureInput) {
        // Pendant la frappe, un champ horaire incomplet vaut '' : on ne vide
        // le réglage qu'à la validation, jamais en cours de saisie.
        departureInput.addEventListener('input', () => {
            if (departureInput.value) updateDraft({ departureTime: departureInput.value });
        });
        departureInput.addEventListener('change', () => updateDraft({ departureTime: departureInput.value || '' }));
    }

    if (locationToggle) {
        locationToggle.addEventListener('change', () => {
            updateDraft({ locationMethod: locationToggle.checked ? 'sncf' : 'geo' });
            syncLocationControls();
        });
    }

    const deltaInput = el('global-delta');
    const setDeltaMinutes = (minutes) => {
        const clamped = Math.max(DELTA_MIN_MINUTES, Math.min(DELTA_MAX_MINUTES, Number.isFinite(minutes) ? minutes : 0));
        updateDraft({ globalDeltaSeconds: clamped * 60 });
        if (deltaInput) deltaInput.value = Math.round(STATE.draftConfig.globalDeltaSeconds / 60).toString();
    };
    if (deltaInput) deltaInput.addEventListener('change', () => setDeltaMinutes(Number(deltaInput.value)));
    const stepDelta = (step) => setDeltaMinutes(Math.round(STATE.draftConfig.globalDeltaSeconds / 60) + step);
    el('delta-minus')?.addEventListener('click', () => stepDelta(-1));
    el('delta-plus')?.addEventListener('click', () => stepDelta(1));

    el('start-btn')?.addEventListener('click', onPrimaryAction);
    el('secondary-btn')?.addEventListener('click', onSecondaryAction);
    el('settings-btn')?.addEventListener('click', () => {
        showView(STATE, 'home');
        syncView();
    });

    // Rotation ou redimensionnement : simple redessin depuis l'état.
    let resizeFrame = null;
    window.addEventListener('resize', () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            renderTracking();
        });
    });

    syncView();
});

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
            navigator.geolocation.getCurrentPosition(showPosition, showError, GEOLOCATION_OPTIONS);
        }
    }
}

function processCurrentPosition() {
    if (STATE.locationMethod === 'sncf') {
        fetchSncfPosition();
    } else if (STATE.locationMethod === 'geo') {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition, showError, GEOLOCATION_OPTIONS);
        } else {
            updateInfo("La géolocalisation n'est pas supportée par ce navigateur.");
        }
    }

    // Perte de signal : l'historique de vitesse est prolongé en non fiable et
    // le suivi redessiné avec l'indicateur de signal perdu.
    if (recordSignalLossTick(STATE)) renderTracking();
}

function showError(error) {
    updateInfo(geoErrorMessage(error));
}

function showPosition(position) {
    const result = ingestFix(STATE, position, Date.now(), {
        locationMethod: STATE.locationMethod,
        speedDivisor: window.FAKE_GPS_SPEED_MULTIPLIER,
        onPassage: (point, delayMs) => console.log(`[Passage] ✅ Point franchi: ${point.name}, retard: ${Math.round(delayMs / 1000)}s`)
    });

    if (!result.accepted) {
        if (result.reason === 'inactive') updateInfo('Route ou heure de départ non initialisée.');
        else if (result.reason === 'accuracy') console.warn(`[GPS] Fix rejeté (précision ±${Math.round(result.accuracyMeters)} m)`);
        else if (result.reason === 'teleport') console.warn('[GPS] Téléportation ignorée');
        return;
    }
    const { sample, snapshot } = result;
    if (sample.reseeded) console.warn('[GPS] Position divergente persistante → ré-ancrage du tracking');

    let infoHtml = `<strong>Position :</strong> ${sample.lat.toFixed(5)}, ${sample.lon.toFixed(5)}.`;
    if (sample.accuracyM) infoHtml += ` (±${Math.round(sample.accuracyM)} m)`;

    if (!snapshot) {
        updateInfo(infoHtml + ' Position actuelle hors de la route prévue.');
        return;
    }

    renderTracking();

    const route = STATE.currentRoute;
    const nextPoint = snapshot.displayIdx < route.length - 1 ? route[snapshot.displayIdx + 1] : null;
    if (nextPoint) {
        infoHtml += ` Prochain : ${nextPoint.name} (${snapshot.progress.distanceToNextPointKm.toFixed(2)} km).`;
    } else {
        infoHtml += ` Arrivée à ${route[snapshot.displayIdx]?.name ?? 'destination'}.`;
    }

    // Enrichissement PK (informatif uniquement — aucun couplage avec le calcul
    // de retard) : PK interpolé sur le corridor ferroviaire si disponible.
    if (STATE.railCorridor) {
        const loc = locateOnCorridor(STATE.railCorridor, sample.lat, sample.lon, STATE.railCorridorIndex, sample.accuracyM);
        if (loc) {
            STATE.railCorridorIndex = loc.index;
            infoHtml += ` PK ${formatPk(loc.pk)}${loc.line ? ` (ligne ${loc.line})` : ''}.`;
        }
    }
    updateInfo(infoHtml);
}
