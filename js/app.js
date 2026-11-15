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
    pauseCarouselFollow, recenterCarousel, renderTripDetails, inspectSpeedProfile, setProfileRange
} from './ui.js';
import { geoErrorMessage } from './geo.js';
import { enterMode } from './app-mode.js';
import { bindDialogCloseButtons, initModeSwitch, markDeviceClass } from './app-shell.js';
import { bindCarouselInteractions } from './carousel-view.js';
import { loadDataset } from './csv.js';
import { buildCorridor, locateOnCorridor } from './linearref.js';
import {
    DELTA_MAX_MINUTES, DELTA_MIN_MINUTES, DELTA_REPEAT_DELAY_MS, DELTA_REPEAT_INTERVAL_MS,
    GEOLOCATION_OPTIONS, SNCF_GPS_URLS, SNCF_TIMEOUT_MS, TRACKING_TICK_MS
} from './train-config.js';
import {
    createSncfTracker, describeSncfFailures, noteSncfFix, parseSncfResponse, pickLocationSource
} from './sncf-telemetry.js';

// Boucle d'acquisition : créée au lancement d'une session, détruite à sa
// clôture. Ni la navigation ni une reconfiguration n'y touchent.
let trackingInterval = null;
let coreDataLoading = true;

// Conteneur iOS relancé sur le mode voiture : la page est remplacée, rien ne
// doit démarrer ici.
const leavingForOtherMode = enterMode('train');

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
    if (leavingForOtherMode) return;
    markDeviceClass();

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

        // Au toucher, le champ natif ouvre lui-même le sélecteur du système.
        // À la souris ou au clavier, il ne fait que placer le curseur sur un
        // segment : le sélecteur est alors demandé explicitement, la saisie
        // directe dans le champ restant le repli des navigateurs sans sélecteur.
        let departurePointerType = '';
        const openDeparturePicker = () => {
            try { departureInput.showPicker(); } catch { /* saisie directe */ }
        };
        departureInput.addEventListener('pointerdown', event => { departurePointerType = event.pointerType; });
        departureInput.addEventListener('click', () => {
            if (departurePointerType !== 'touch') openDeparturePicker();
        });
        departureInput.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openDeparturePicker();
        });
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
    // Un appui = une minute, un appui maintenu répète. Le pas est appliqué dès
    // l'appui ; le clic ne sert qu'au clavier et aux technologies d'assistance
    // (aucun pointeur, `detail` nul).
    const bindDeltaButton = (button, step) => {
        let delay = null;
        let repeat = null;
        const stop = () => {
            if (delay !== null) clearTimeout(delay);
            if (repeat !== null) clearInterval(repeat);
            delay = repeat = null;
        };
        button.addEventListener('pointerdown', event => {
            if (event.button !== 0 || button.disabled) return;
            stop();
            stepDelta(step);
            delay = setTimeout(() => {
                delay = null;
                repeat = setInterval(() => {
                    if (button.disabled) stop();
                    else stepDelta(step);
                }, DELTA_REPEAT_INTERVAL_MS);
            }, DELTA_REPEAT_DELAY_MS);
        });
        ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(type => button.addEventListener(type, stop));
        button.addEventListener('contextmenu', event => event.preventDefault());
        button.addEventListener('click', event => { if (event.detail === 0) stepDelta(step); });
    };
    bindDeltaButton(el('delta-minus'), -1);
    bindDeltaButton(el('delta-plus'), 1);

    el('start-btn')?.addEventListener('click', onPrimaryAction);
    el('secondary-btn')?.addEventListener('click', onSecondaryAction);
    el('settings-btn')?.addEventListener('click', () => {
        showView(STATE, 'home');
        syncView();
    });

    const endSession = () => {
        stopTrackingLoop();
        stopSession(STATE);
        syncView();
    };
    el('confirm-end-btn').addEventListener('click', () => {
        el('end-session').close();
        endSession();
    });
    initModeSwitch({ mode: 'train', isSessionActive: () => STATE.session.active, endSession });
    el('details-btn').addEventListener('click', () => {
        el('trip-details').showModal();
        renderTripDetails();
    });
    bindDialogCloseButtons();
    [el('speed-profile'), el('details-profile')].forEach(canvas => {
        ['pointermove', 'pointerdown', 'keydown'].forEach(type => canvas.addEventListener(type, event => inspectSpeedProfile(canvas, event)));
    });
    document.querySelectorAll('[data-profile-range]').forEach(button => {
        button.addEventListener('click', () => setProfileRange(button.dataset.profileRange));
    });
    const carousel = el('train-carousel');
    bindCarouselInteractions(carousel, el('recenter-btn'), { pause: pauseCarouselFollow, recenter: recenterCarousel });

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

// Suivi de la télémétrie SNCF, propre à une session (endpoint retenu,
// fraîcheur, dernier échec).
let sncfTracker = null;
let sncfTrackerSession = null;
function getSncfTracker(session) {
    if (sncfTrackerSession !== session) {
        sncfTracker = createSncfTracker();
        sncfTrackerSession = session;
    }
    return sncfTracker;
}

// Bridge natif du conteneur iOS (ios/Tallon/SncfBridge.swift) : requête
// URLSession hors du contexte CORS de la page.
const nativeBridge = () => window.webkit?.messageHandlers?.tallonNative;

async function requestSncf(url) {
    const bridge = nativeBridge();
    if (bridge) {
        try {
            return await bridge.postMessage({ op: 'sncf', url, timeoutMs: SNCF_TIMEOUT_MS });
        } catch (error) {
            return { ok: false, kind: 'refused', detail: error.message };
        }
    }
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(SNCF_TIMEOUT_MS) });
        return { ok: true, status: response.status, body: await response.text() };
    } catch (error) {
        // Le navigateur ne distingue pas un blocage CORS d'un réseau absent.
        return { ok: false, kind: error.name === 'TimeoutError' ? 'timeout' : 'blocked' };
    }
}

/**
 * Interroge le routeur et ingère la position si elle est neuve.
 * @param {string} active - source active au lancement de la requête : 'geo'
 *   quand il s'agit d'une tentative de retour depuis le repli GPS.
 */
async function fetchSncfPosition(session, active) {
    if (window.IS_SCRIPTABLE_BRIDGE || navigator.userAgent.includes('Scriptable')) return;
    const tracker = getSncfTracker(session);
    const urls = tracker.url ? [tracker.url] : (nativeBridge() ? SNCF_GPS_URLS : SNCF_GPS_URLS.slice(0, 1));
    const failures = [];
    let result = null;
    for (const url of urls) {
        const attempt = parseSncfResponse(await requestSncf(url));
        if (attempt.ok) { result = attempt; tracker.url = url; break; }
        failures.push(attempt);
    }
    if (!result) {
        tracker.url = null;
        throw new Error(describeSncfFailures(failures));
    }
    if (STATE.session !== session || STATE.locationMethod !== active) return;
    const freshness = noteSncfFix(tracker, result.routerTs, Date.now());
    if (freshness === 'stale') throw new Error(parseSncfResponse({ ok: false, kind: 'stale' }).message);
    if (freshness === 'duplicate') return;
    if (active !== 'sncf') {
        STATE.locationMethod = 'sncf';
        // La requête GPS encore en vol sera ignorée : elle ne doit pas retenir
        // l'acquisition SNCF jusqu'à son délai d'expiration.
        pendingRequest = null;
        acquisitionPending = false;
        updateInfo('WiFi SNCF rétabli, retour à la télémétrie du train.');
    }
    tracker.lastError = null;
    showPosition(result.fix);
}

function processCurrentPosition() {
    if (!STATE.session.active) return;
    // L'horloge de rendu ne dépend pas de l'arrivée d'un fix (attente, refus,
    // perte de signal, arrêt en gare). Une seule acquisition peut être en vol.
    recordSignalLossTick(STATE);
    renderTracking();
    const session = STATE.session;
    const active = STATE.locationMethod;
    const tracker = getSncfTracker(session);
    const isCurrent = () => STATE.session === session && STATE.locationMethod === active;
    const onSncfError = error => {
        if (!isCurrent()) return;
        tracker.failedAt = Date.now();
        if (active === 'sncf') {
            STATE.locationMethod = 'geo';
            updateInfo(`WiFi SNCF indisponible (${error.message}), bascule sur GPS natif.`);
        } else if (tracker.lastError !== error.message) {
            updateInfo(`WiFi SNCF toujours indisponible (${error.message}), GPS natif conservé.`);
        }
        tracker.lastError = error.message;
    };
    // En repli GPS, la tentative de retour au WiFi SNCF court en parallèle de
    // l'acquisition : un routeur muet ne prive pas le suivi de ses fix GPS.
    // FakeGeoSim impose le GPS : aucune tentative.
    if (active !== 'sncf' && !tracker.probing && !window.FAKE_GPS_SPEED_MULTIPLIER && pickLocationSource({
        preferred: STATE.appliedConfig?.locationMethod, active, failedAt: tracker.failedAt
    }, Date.now()) === 'sncf') {
        tracker.probing = true;
        fetchSncfPosition(session, active).catch(onSncfError).finally(() => { tracker.probing = false; });
    }
    if (acquisitionPending) return;
    const request = pendingRequest = {};
    acquisitionPending = true;
    const finish = () => { if (pendingRequest === request) acquisitionPending = false; };
    if (active === 'sncf') {
        fetchSncfPosition(session, active).catch(onSncfError).finally(finish);
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
