import { STATE, restoreSettings, saveSettings } from './state.js';
import { buildServiceSummary, createTripConfig } from './trip-config.js';
import { ingestFix, recordSignalLossTick } from './tracking-session.js';
import {
    adoptLocationMethod, applyDraft, buildDraftPlan, getHomeAction, launchSession,
    revertDraft, setDraft, showView, stopSession
} from './train-controller.js';
import {
    populateRouteChoices, syncFormControls, syncLocationControls, updateInfo,
    renderTrainTracking, renderServiceSummary, renderHomeActions, renderNavigation,
    pauseCarouselFollow, recenterCarousel, renderTripDetails, inspectSpeedProfile
} from './ui.js';
import { geoErrorMessage } from './geo.js';
import { loadDataset } from './csv.js';
import { buildCorridor, locateOnCorridor } from './linearref.js';
import { DELTA_MAX_MINUTES, DELTA_MIN_MINUTES, GEOLOCATION_OPTIONS, TRACKING_TICK_MS } from './train-config.js';

// Boucle d'acquisition : créée au lancement d'une session, détruite à sa
// clôture. Ni la navigation ni une reconfiguration n'y touchent.
let trackingInterval = null;
let coreDataLoading = true;

// La détection ne peut pas reposer sur le seul user-agent : dans une WebView
// hôte (Scriptable), l'UA peut ne pas contenir « iPhone », ce qui basculerait
// la page sur la mise en page non-iPhone (HUD surdimensionné) sur un iPhone.
// navigator.platform reste fiable dans WebKit quel que soit l'UA.
function isIPhoneDevice() {
    if (typeof navigator === 'undefined') return false;
    if (/iPhone|iPod/i.test(navigator.userAgent || '')) return true;
    return navigator.platform === 'iPhone' || navigator.platform === 'iPod touch';
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
    const summary = buildServiceSummary(buildDraftPlan(STATE));
    if (coreDataLoading && summary.status === 'data-unavailable') summary.status = 'loading';
    renderServiceSummary(summary);
    renderHomeActions(getHomeAction(STATE));
}

function updateDraft(patch) {
    setDraft(STATE, patch);
    saveSettings();
    renderHome();
}

function renderTracking(options) {
    renderTrainTracking(options);
}

function syncView() {
    renderNavigation();
    renderHome();
    renderTracking({ relayout: true });
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
    acquisitionPending = false;
    pendingRequest = null;
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
        syncFormControls(STATE.draftConfig);
        renderHome();
    } else if (action.secondary === 'end') {
        el('end-session').showModal();
    }
}

// Bridge de communication pour Scriptable
window.addEventListener('message', (e) => {
    if (e.data?.coords && e.data.type === 'SNCF_GPS_BRIDGE') {
        window.IS_SCRIPTABLE_BRIDGE = true;
        if (STATE.locationMethod !== 'sncf') {
            adoptLocationMethod(STATE, 'sncf');
            syncLocationControls();
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
    STATE.draftConfig = createTripConfig(STATE.draftConfig);
    syncFormControls(STATE.draftConfig);

    // Chaque champ ne modifie que la configuration provisoire : la session en
    // cours n'en voit rien avant « Appliquer ».
    el('route-choices').addEventListener('change', event => {
        if (!event.target.matches('input[type="radio"]')) return;
        updateDraft({ mainRouteKey: event.target.value });
        populateRouteChoices(STATE.draftConfig.mainRouteKey);
    });
    el('service-rest').addEventListener('click', event => {
        const button = event.target.closest('[data-stop-id]');
        if (!button) return;
        const ids = new Set(STATE.draftConfig.stopIds);
        if (button.dataset.stopAction === 'add') ids.add(button.dataset.stopId);
        else ids.delete(button.dataset.stopId);
        updateDraft({ stopIds: [...ids] });
    });

    const departureInput = el('departure-time');
    if (departureInput) {
        // Pendant la frappe, un champ horaire incomplet vaut '' : on ne vide
        // le réglage qu'à la validation, jamais en cours de saisie.
        departureInput.addEventListener('input', () => {
            if (departureInput.value) updateDraft({ departureTime: departureInput.value });
        });
        departureInput.addEventListener('change', () => updateDraft({ departureTime: departureInput.value || '' }));
    }

    document.querySelectorAll('input[name="location-method"]').forEach(input => {
        input.addEventListener('change', () => {
            updateDraft({ locationMethod: input.value });
            syncLocationControls();
        });
    });

    const deltaInput = el('global-delta');
    const setDeltaMinutes = (minutes) => {
        const clamped = Math.max(DELTA_MIN_MINUTES, Math.min(DELTA_MAX_MINUTES, Number.isFinite(minutes) ? Math.round(minutes) : 0));
        updateDraft({ globalDeltaSeconds: clamped * 60 });
        if (deltaInput) deltaInput.value = Math.round(STATE.draftConfig.globalDeltaSeconds / 60).toString();
    };
    deltaInput?.addEventListener('input', () => {
        if (deltaInput.value !== '') setDeltaMinutes(Number(deltaInput.value));
    });
    deltaInput?.addEventListener('change', () => setDeltaMinutes(Number(deltaInput.value)));
    const stepDelta = (step) => setDeltaMinutes(Math.round(STATE.draftConfig.globalDeltaSeconds / 60) + step);
    el('delta-minus')?.addEventListener('click', () => stepDelta(-1));
    el('delta-plus')?.addEventListener('click', () => stepDelta(1));

    el('start-btn')?.addEventListener('click', onPrimaryAction);
    el('secondary-btn')?.addEventListener('click', onSecondaryAction);
    el('settings-btn')?.addEventListener('click', () => {
        showView(STATE, 'home');
        syncView();
    });

    el('confirm-end-btn').addEventListener('click', () => {
        el('end-session').close();
        stopTrackingLoop();
        stopSession(STATE);
        syncView();
    });
    el('details-btn').addEventListener('click', () => {
        el('trip-details').showModal();
        renderTripDetails();
    });
    document.querySelectorAll('[data-close-dialog]').forEach(button => {
        button.addEventListener('click', () => button.closest('dialog').close());
    });
    [el('speed-profile'), el('details-profile')].forEach(canvas => {
        ['pointermove', 'pointerdown', 'keydown'].forEach(type => canvas.addEventListener(type, event => inspectSpeedProfile(canvas, event)));
    });
    const carousel = el('train-carousel');
    ['wheel', 'touchstart', 'pointerdown'].forEach(type => carousel.addEventListener(type, pauseCarouselFollow, { passive: true }));
    carousel.addEventListener('keydown', event => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseCarouselFollow();
    });
    el('recenter-btn').addEventListener('click', () => {
        recenterCarousel();
        carousel.focus({ preventScroll: true });
    });

    // Observe la surface réellement disponible, y compris clavier, barres iOS,
    // réglage de taille du texte ou redimensionnement du dialogue.
    let resizeFrame = null;
    const onResize = () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            renderTracking({ relayout: true });
        });
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(onResize);
        [carousel, el('speed-profile'), el('details-profile')].forEach(node => observer.observe(node));
    }

    syncView();
    await loadCoreData();
    coreDataLoading = false;
    // Les commandes sont déjà utilisables pendant les chargements réseau.
    loadRailPkCorridor();
    syncView();
});

let acquisitionPending = false;
let pendingRequest = null;

async function fetchSncfPosition(session, source) {
    if (window.IS_SCRIPTABLE_BRIDGE || navigator.userAgent.includes('Scriptable')) return;
    const response = await fetch('https://wifi.sncf/router/api/train/gps', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('API injoignable');
    const data = await response.json();
    if (!data.success) throw new Error('Données invalides');
    if (STATE.session !== session || STATE.locationMethod !== source) return;
    const speedKmh = data.speed != null && Number.isFinite(Number(data.speed)) ? Number(data.speed) * 3.6 : undefined;
    showPosition({ coords: { latitude: data.latitude, longitude: data.longitude, accuracy: 15, speed: speedKmh }, timestamp: data.timestamp ? data.timestamp * 1000 : Date.now() });
}

function processCurrentPosition() {
    if (!STATE.session.active) return;
    // L'horloge de rendu ne dépend pas de l'arrivée d'un fix (attente, refus,
    // perte de signal, arrêt en gare). Une seule acquisition peut être en vol.
    recordSignalLossTick(STATE);
    renderTracking();
    if (acquisitionPending) return;
    const session = STATE.session;
    const source = STATE.locationMethod;
    const request = pendingRequest = {};
    acquisitionPending = true;
    const isCurrent = () => STATE.session === session && STATE.locationMethod === source;
    const finish = () => { if (pendingRequest === request) acquisitionPending = false; };
    if (source === 'sncf') {
        fetchSncfPosition(session, source).catch(error => {
            if (!isCurrent()) return;
            STATE.locationMethod = 'geo';
            updateInfo(`WiFi SNCF indisponible (${error.message}), bascule sur GPS natif.`);
        }).finally(finish);
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            if (isCurrent()) showPosition(position);
            finish();
        }, error => {
            if (isCurrent()) updateInfo(geoErrorMessage(error));
            finish();
        }, GEOLOCATION_OPTIONS);
    } else {
        updateInfo('La géolocalisation n’est pas supportée par ce navigateur.');
        finish();
    }
}

function showPosition(position) {
    const result = ingestFix(STATE, position, Date.now(), {
        locationMethod: STATE.locationMethod,
        speedDivisor: window.FAKE_GPS_SPEED_MULTIPLIER,
        onPassage: (point, delayMs) => console.log(`[Passage] ✅ Point franchi: ${point.name}, retard: ${Math.round(delayMs / 1000)}s`)
    });

    if (!result.accepted) {
        if (result.reason === 'accuracy') console.warn(`[GPS] Fix rejeté (précision ±${Math.round(result.accuracyMeters)} m)`);
        else if (result.reason === 'teleport') console.warn('[GPS] Téléportation ignorée');
        return;
    }
    const { sample } = result;
    if (sample.reseeded) console.warn('[GPS] Position divergente persistante → ré-ancrage du tracking');

    // Enrichissement PK (informatif uniquement — aucun couplage avec le calcul
    // de retard) : PK interpolé sur le corridor ferroviaire si disponible.
    let railLocation = null;
    if (STATE.railCorridor) {
        const loc = locateOnCorridor(STATE.railCorridor, sample.lat, sample.lon, STATE.railCorridorIndex, sample.accuracyM);
        if (loc) {
            STATE.railCorridorIndex = loc.index;
            railLocation = loc;
        }
    }
    // Un fix hors route reste historisé et change l'état du signal affiché.
    renderTracking({ railLocation });
}
