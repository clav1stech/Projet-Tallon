// js/car-app.js
// Orchestrateur du mode voiture (car.html) — suivi Mâcon → Combloux.
//
// Réutilise le cœur partagé avec le rail :
// - csv.js / linearref.js : datasets PK-PR décrits par JSON (aucun recodage
//   quand le CSV réel arrive) ;
// - position-engine.js : fiabilité GPS partagée, avec un profil voiture plus
//   réactif et priorité à la vitesse native de Geolocation ;
// - functions.js : matching de segment (fenêtre glissante, tolérance GPS),
//   AVEC fallback latitude DÉSACTIVÉ — l'itinéraire est globalement ouest-est,
//   un fallback cardinal serait faux par construction. Le repli en cas d'échec
//   de matching est purement séquentiel : on reste sur le dernier index validé.
//
// Pas de notion d'horaire/retard : affichage de la progression et de la
// distance restante.
//
// Cycle de session (car-session.js, mêmes règles que le train) : l'acquisition
// GPS est créée au lancement et détruite à la clôture, jamais ailleurs. Ni la
// navigation ni un changement d'itinéraire n'y touchent ; ce dernier ne remet
// à zéro que la progression le long de l'ancien trajet.

import { STATE } from './state.js';
import { CAR_ROUTES, CAR_TRACKING_CONFIG } from './car-config.js';
import { loadDataset, DatasetError } from './csv.js';
import {
    buildCarRoute,
    estimateDeclaredTunnelProgress,
    findSector,
    listDeclaredTunnels,
    listRouteSectors,
    locateRouteProgress,
    resolveWaypointTarget
} from './car-route.js';
import { applyCarWaypointOverrides, loadCarWaypointOverrides } from './car-waypoint-overrides.js';
import { createPositionEngine } from './position-engine.js';
import { isGpsSignalStale } from './tracking.js';
import {
    computeSegmentIndexAndDistance,
    projectPositionOnRouteSegment,
    findNearestSegmentIndex
} from './functions.js';
import { geoErrorMessage } from './geo.js';
import {
    inspectSpeedProfile, pauseCarouselFollow, recenterCarousel, renderCarDetails, renderCarHome,
    renderCarNavigation, renderCarTracking, setProfileRange, updateCarInfo
} from './car-ui.js';
import {
    applyDraft, createCarSessionState, createTripStats, getHomeAction, launchSession, recordMeasuredFix,
    restoreCarSettings, revertDraft, reverseRouteKey, saveCarSettings, setDraft, showView, stopSession
} from './car-session.js';
import { enterMode } from './app-mode.js';
import { bindDialogCloseButtons, el, initModeSwitch, markDeviceClass } from './app-shell.js';
import { bindCarouselInteractions } from './carousel-view.js';

// Conteneur iOS relancé sur le mode train : la page est remplacée, rien ne
// doit démarrer ici.
const leavingForOtherMode = enterMode('car');

// Navigation, configuration provisoire/appliquée et session (car-session.js).
const SESSION = createCarSessionState();

// Itinéraires construits, par clé CAR_ROUTES : aperçu de l'accueil et suivi
// partagent la même construction. { status: 'loading'|'ok'|'error', route,
// cfg, totalKm, sectors, message }
const ROUTES = new Map();

const CAR = {
    route: null,            // { points, cumKm, totalKm, legs, waypoints } (buildCarRoute)
    routeKey: null,         // clé CAR_ROUTES sélectionnée
    routeCfg: null,         // entrée CAR_ROUTES (secteurs — findSector)
    lastSegmentIndex: null, // garde-fou séquentiel : ne recule jamais
    // Mesures de vitesse de la session : { ts, v, reliable, speedReliable,
    // routeKm }. Une progression estimée y entre comme non fiable — le profil
    // la laisse en interruption, sans l'interpoler.
    speedHistory: [],
    stats: createTripStats(),
    status: { signal: 'waiting', text: 'GPS · En attente de localisation' },
    lastFix: null,          // { lat, lon } de la dernière position mesurée
    arrived: false,
    watchId: null,
    freshnessInterval: null,
    trackingStartedAt: 0,
    lastFixAt: 0,
    lastKnownSpeedKmh: 0,
    lastLostSampleAt: 0,
    gpsLost: false,
    inTunnel: false,
    tunnelInGrace: false,
    absenceMode: null,
    absenceFrozenDoneKm: null,
    lastRenderData: null,
    lastFixRenderData: null
};

const engine = createPositionEngine({
    maxSpeedKmh: CAR_TRACKING_CONFIG.maxSpeedKmh,
    historySize: CAR_TRACKING_CONFIG.positionHistorySize,
    trustReportedSpeed: true,
    reportedSpeedMultiplier: 3.6, // GeolocationCoordinates.speed est en m/s.
    filterReportedSpeed: false,
    divideReportedSpeed: false,
    speedSpikeThresholdKmh: CAR_TRACKING_CONFIG.speedSpikeThresholdKmh,
    speedSpikeStepKmh: CAR_TRACKING_CONFIG.speedSpikeStepKmh,
    // fakeGeoSim accélère les positions ×N : seule la vitesse recalculée
    // depuis la géométrie doit être re-divisée, pas coords.speed.
    speedDivisor: () => window.FAKE_GPS_SPEED_MULTIPLIER || 1
});

function appendSpeedSample(speedKmh, reliable, timestamp = Date.now(), routeKm = null) {
    CAR.speedHistory.push({ v: speedKmh, reliable, speedReliable: reliable, ts: timestamp, routeKm });
    if (CAR.speedHistory.length > CAR_TRACKING_CONFIG.speedHistoryMax) {
        CAR.speedHistory.shift();
    }
}

function setStatus(signal, text) {
    CAR.status = { signal, text };
}

/** Modèle du cockpit : état de suivi courant et vues de données de la session. */
function buildTrackingModel() {
    let maxKmh = 0;
    for (const sample of CAR.speedHistory) if (sample.reliable && sample.v > maxKmh) maxKmh = sample.v;
    return {
        routeKey: CAR.routeKey,
        waypoints: CAR.route.waypoints,
        totalKm: CAR.route.totalKm,
        data: CAR.lastRenderData,
        status: CAR.status,
        stats: CAR.stats,
        lastFix: CAR.lastFix,
        profile: {
            samples: CAR.speedHistory,
            planned: [],
            stops: [],
            passages: [],
            totalKm: CAR.route.totalKm,
            currentKm: CAR.lastRenderData?.doneKm ?? null,
            maxKmh
        }
    };
}

/** Le rendu part de l'état : il se rejoue sans nouveau fix (retour des réglages, rotation). */
function renderTracking(options) {
    if (!SESSION.session.active || SESSION.view !== 'tracking' || !CAR.route) return;
    renderCarTracking(buildTrackingModel(), options);
}

function present(data) {
    CAR.lastRenderData = data;
    renderTracking();
}

function buildEstimatedRenderData(base, doneKm, { inTunnel, gpsLost, tunnelName }) {
    const progress = locateRouteProgress(CAR.route, doneKm);
    if (!base || !progress) return base;

    const route = CAR.route.points;
    const cumKm = CAR.route.cumKm;
    const segmentIndex = progress.segmentIndex;
    const a = route[segmentIndex];
    const b = route[segmentIndex + 1];
    if (CAR.lastSegmentIndex === null || segmentIndex > CAR.lastSegmentIndex) {
        CAR.lastSegmentIndex = segmentIndex;
    }

    let pk = null;
    let line = null;
    if (a && b && Number.isFinite(a.pk) && Number.isFinite(b.pk)) {
        const segLen = cumKm[segmentIndex + 1] - cumKm[segmentIndex];
        const ratio = segLen > 0 ? progress.distanceFromSegmentStart / segLen : 0;
        pk = a.pk + Math.max(0, Math.min(1, ratio)) * (b.pk - a.pk);
        line = a.line ?? null;
    }

    const target = resolveWaypointTarget(CAR.route.waypoints, progress.routeKm);

    return {
        ...base,
        legLabel: a?.legLabel ?? base.legLabel,
        pk,
        line,
        nextWaypoint: target.nextWaypoint,
        nextIndex: target.nextIndex,
        nextDistanceKm: target.nextDistanceKm,
        onStructure: target.onStructure,
        structureProgress: target.structureProgress,
        doneKm: progress.routeKm,
        remainingKm: Math.max(0, CAR.route.totalKm - progress.routeKm),
        speedKmh: CAR.lastKnownSpeedKmh,
        speedReliable: false,
        gpsLost,
        inTunnel,
        tunnelName,
        sector: findSector(CAR.routeCfg, a?.legIndex, pk)
    };
}

function renderGpsLoss(now = Date.now(), force = false) {
    if (!CAR.route) return;
    if (!force && !isGpsSignalStale(
        CAR.lastFixAt,
        CAR.trackingStartedAt,
        now,
        CAR_TRACKING_CONFIG.gpsLostAfterMs
    )) return;

    const base = CAR.lastFixRenderData || CAR.lastRenderData;
    const estimate = base && CAR.lastFixAt > 0 && CAR.absenceMode !== 'lost'
        ? estimateDeclaredTunnelProgress(
            CAR.route,
            base.doneKm,
            CAR.lastKnownSpeedKmh,
            Math.max(0, now - CAR.lastFixAt),
            {
                entryToleranceM: CAR_TRACKING_CONFIG.tunnelEntryToleranceM,
                exitGraceMs: CAR_TRACKING_CONFIG.tunnelExitGraceMs
            }
        )
        : null;
    const tunnelActive = estimate?.phase === 'tunnel';
    const firstTunnelRender = tunnelActive && !CAR.inTunnel;
    const firstLostRender = !tunnelActive && !CAR.gpsLost;

    CAR.inTunnel = tunnelActive;
    CAR.tunnelInGrace = tunnelActive && Boolean(estimate.inExitGrace);
    CAR.gpsLost = !tunnelActive;
    if (tunnelActive) {
        CAR.absenceMode = 'tunnel';
    } else if (CAR.absenceMode !== 'lost') {
        CAR.absenceMode = 'lost';
        CAR.absenceFrozenDoneKm = estimate?.doneKm ?? base?.doneKm ?? null;
    }
    if (firstTunnelRender || firstLostRender || now - CAR.lastLostSampleAt >= CAR_TRACKING_CONFIG.lostGraphSampleMs) {
        appendSpeedSample(CAR.lastKnownSpeedKmh, false, now);
        CAR.lastLostSampleAt = now;
    }

    if (base) {
        const staleData = buildEstimatedRenderData(
            base,
            estimate?.doneKm ?? CAR.absenceFrozenDoneKm ?? base.doneKm,
            {
                inTunnel: tunnelActive,
                gpsLost: !tunnelActive,
                tunnelName: estimate?.tunnel?.name ?? null
            }
        );
        // L'état du signal est posé avant le rendu : la position estimée
        // n'apparaît jamais sous un libellé de signal actif.
        if (tunnelActive) {
            setStatus('tunnel', estimate.inExitGrace
                ? `Fin de ${estimate.tunnel.name} · recherche du GPS, position estimée`
                : `${estimate.tunnel.name} · position estimée à la vitesse d’entrée`);
        } else {
            setStatus('lost', 'Signal GPS perdu · progression suspendue');
        }
        present(staleData);
    } else if (firstLostRender) {
        // Aucune position depuis le lancement : rien à suspendre.
        setStatus('waiting', 'GPS · En attente de localisation');
        renderTracking();
    }
    return tunnelActive ? 'tunnel' : 'lost';
}

async function buildRouteEntry(routeKey) {
    const cfg = CAR_ROUTES[routeKey];
    if (!cfg) throw new Error(`Itinéraire inconnu : ${routeKey}`);

    // Chargement des datasets déclarés par l'itinéraire (descripteurs JSON)
    const datasetsById = {};
    for (const url of cfg.datasets || []) {
        const ds = await loadDataset(url);
        datasetsById[ds.descriptor.id] = ds;
    }

    const effectiveCfg = applyCarWaypointOverrides(cfg, loadCarWaypointOverrides());
    const route = buildCarRoute(effectiveCfg, datasetsById);
    return { status: 'ok', route, cfg: effectiveCfg, totalKm: route.totalKm, sectors: listRouteSectors(route, effectiveCfg) };
}

/** Construit l'itinéraire s'il ne l'est pas encore, puis rafraîchit l'accueil. */
function ensureRoute(routeKey) {
    if (!CAR_ROUTES[routeKey] || ROUTES.has(routeKey)) return;
    ROUTES.set(routeKey, { status: 'loading' });
    buildRouteEntry(routeKey).catch(e => {
        console.error('buildRouteEntry error:', e);
        return {
            status: 'error',
            message: e instanceof DatasetError
                ? `Données de l’itinéraire indisponibles (${e.code}). Rechargez la page pour réessayer.`
                : `Itinéraire inutilisable : ${e.message}`
        };
    }).then(entry => {
        ROUTES.set(routeKey, entry);
        renderHome();
    });
}

const routePreview = routeKey => ROUTES.get(routeKey) || { status: CAR_ROUTES[routeKey] ? 'loading' : 'no-route' };
const isDraftReady = () => routePreview(SESSION.draftConfig.routeKey).status === 'ok';

/** Acquisition : remise à zéro au lancement et à la clôture d'une session. */
function resetAcquisition(nowTs = Date.now()) {
    CAR.trackingStartedAt = nowTs;
    CAR.lastFixAt = 0;
    CAR.lastKnownSpeedKmh = 0;
    CAR.lastFix = null;
    engine.reset();
}

/**
 * Suivi le long de l'itinéraire : tout ce qui se mesure en km-route de
 * l'ancien trajet devient invalide quand il change. L'acquisition (moteur de
 * position, fraîcheur du signal) n'est pas concernée.
 */
function resetRouteTracking() {
    CAR.lastSegmentIndex = null;
    CAR.speedHistory = [];
    CAR.stats = createTripStats();
    CAR.arrived = false;
    CAR.lastLostSampleAt = 0;
    CAR.gpsLost = false;
    CAR.inTunnel = false;
    CAR.tunnelInGrace = false;
    CAR.absenceMode = null;
    CAR.absenceFrozenDoneKm = null;
    CAR.lastRenderData = null;
    CAR.lastFixRenderData = null;
    setStatus('waiting', 'GPS · En attente de localisation');
}

/** Installe l'itinéraire appliqué comme trajet suivi. */
function installRoute(routeKey) {
    const entry = ROUTES.get(routeKey);
    CAR.route = entry.route;
    CAR.routeKey = routeKey;
    CAR.routeCfg = entry.cfg;
    resetRouteTracking();

    // Compat fakeGeoSim (dev) : la simulation lit STATE.currentRoute et les
    // durationEffective par point — buildCarRoute les fournit. Les bornes des
    // tunnels lui permettent en plus de se taire à l'intérieur, seule façon de
    // rejouer la coupure de signal sans monter en voiture. Sans simulateur
    // chargé, personne ne lit cette valeur.
    STATE.currentRoute = CAR.route.points;
    window.FAKE_GPS_SIGNAL_GAPS = listDeclaredTunnels(CAR.route);
}

function onPosition(position) {
    if (!SESSION.session.active || !CAR.route) return;

    const result = engine.process(position);
    if (!result.accepted) {
        if (result.reason === 'accuracy') {
            updateCarInfo(`Fix GPS rejeté (précision ±${Math.round(result.accuracyMeters)} m).`);
        } else if (result.reason === 'teleport') {
            updateCarInfo('Position incohérente ignorée (anti-téléportation).');
        }
        return;
    }

    const { lat, lon, accuracyMeters, speedKmh, speedReliable, reseeded } = result;

    const fixTimestamp = Date.now();
    CAR.lastFixAt = fixTimestamp;
    CAR.gpsLost = false;
    CAR.inTunnel = false;
    CAR.tunnelInGrace = false;
    CAR.absenceMode = null;
    CAR.absenceFrozenDoneKm = null;
    CAR.lastLostSampleAt = 0;
    CAR.lastFix = { lat, lon };
    if (speedReliable) CAR.lastKnownSpeedKmh = speedKmh;
    const accuracyText = Number.isFinite(accuracyMeters) ? ` · ±${Math.round(accuracyMeters)} m` : '';

    const route = CAR.route.points;

    // Seed (premier fix ou ré-ancrage) : segment le plus proche par projection
    if (CAR.lastSegmentIndex === null || reseeded) {
        CAR.lastSegmentIndex = findNearestSegmentIndex(route, lat, lon);
    }

    // Matching : fenêtre autour du dernier index, SANS fallback latitude
    // (itinéraire ouest-est — voir en-tête de fichier).
    let { segmentIndex, distanceFromSegmentStart, distanceToNextPointKm } = computeSegmentIndexAndDistance(
        route, lat, lon, CAR.lastSegmentIndex, accuracyMeters, null,
        { disableLatitudeFallback: true }
    );

    let offRoute = false;
    if (segmentIndex === null || segmentIndex < 0) {
        // Repli SÉQUENTIEL : le corridor est dense (~100 m entre PR), en cas
        // d'échec temporaire (perte GPS, saut de précision) on conserve le
        // dernier index validé et on reprendra sur les points suivants.
        if (CAR.lastSegmentIndex === null) {
            appendSpeedSample(speedKmh, speedReliable, fixTimestamp);
            setStatus('off-route', `GPS · Position hors itinéraire, en attente d’accrochage${accuracyText}`);
            renderTracking();
            return;
        }
        segmentIndex = CAR.lastSegmentIndex;
        const projection = projectPositionOnRouteSegment(route, segmentIndex, lat, lon);
        distanceFromSegmentStart = projection.distanceFromSegmentStart;
        distanceToNextPointKm = projection.distanceToNextPointKm;
        offRoute = true;
    }

    // Garde-fou unidirectionnel (identique au rail) : l'index ne recule jamais,
    // les distances sont reprojetées sur le segment retenu.
    if (segmentIndex < CAR.lastSegmentIndex) {
        segmentIndex = CAR.lastSegmentIndex;
        const projection = projectPositionOnRouteSegment(route, segmentIndex, lat, lon);
        distanceFromSegmentStart = projection.distanceFromSegmentStart;
        distanceToNextPointKm = projection.distanceToNextPointKm;
    }
    if (segmentIndex > CAR.lastSegmentIndex) {
        CAR.lastSegmentIndex = segmentIndex;
    }

    // Progression le long de la route aplatie
    const cumKm = CAR.route.cumKm;
    const doneKm = cumKm[segmentIndex] + Math.max(0, distanceFromSegmentStart);
    const remainingKm = Math.max(0, CAR.route.totalKm - doneKm);
    appendSpeedSample(speedKmh, speedReliable, fixTimestamp, doneKm);
    recordMeasuredFix(CAR.stats, { ts: fixTimestamp, routeKm: doneKm, speedKmh, speedReliable });

    if (segmentIndex >= route.length - 2 && distanceToNextPointKm < CAR_TRACKING_CONFIG.arrivalThresholdKm) {
        CAR.arrived = true;
    }

    // PK interpolé si le segment courant appartient à un leg corridor
    const a = route[segmentIndex];
    const b = route[segmentIndex + 1];
    let pk = null;
    let line = null;
    if (a && b && Number.isFinite(a.pk) && Number.isFinite(b.pk)) {
        const segLen = cumKm[segmentIndex + 1] - cumKm[segmentIndex];
        const ratio = segLen > 0 ? Math.max(0, Math.min(1, distanceFromSegmentStart / segLen)) : 0;
        pk = a.pk + ratio * (b.pk - a.pk);
        line = a.line ?? null;
    }

    // Prochain point de passage (sortie, échangeur, ouvrage d'art, étape) —
    // liste triée par km-route fournie par buildCarRoute. Un ouvrage d'art
    // reste la cible affichée jusqu'à sa sortie (resolveWaypointTarget).
    const target = resolveWaypointTarget(CAR.route.waypoints, doneKm);

    const sector = findSector(CAR.routeCfg, a?.legIndex, pk);
    const renderData = {
        routeKey: CAR.routeKey,
        waypoints: CAR.route.waypoints,
        legLabel: a?.legLabel ?? '',
        pk,
        line,
        nextWaypoint: target.nextWaypoint,
        nextIndex: target.nextIndex,
        nextDistanceKm: target.nextDistanceKm,
        onStructure: target.onStructure,
        structureProgress: target.structureProgress,
        doneKm,
        remainingKm,
        totalKm: CAR.route.totalKm,
        speedKmh,
        speedReliable,
        gpsLost: false,
        inTunnel: false,
        tunnelName: null,
        sector,
        arrived: CAR.arrived
    };
    CAR.lastFixRenderData = renderData;
    setStatus(offRoute ? 'off-route' : 'ok', offRoute
        ? `GPS · Hors itinéraire, dernier tronçon conservé${accuracyText}`
        : `GPS · Signal actif${accuracyText}`);
    present(renderData);
}

function onGeoError(error) {
    // Un refus de permission n'est pas un tunnel ; TIMEOUT et
    // POSITION_UNAVAILABLE correspondent bien à une disette de signal.
    if (error?.code === 1) {
        setStatus('error', geoErrorMessage(error));
        renderTracking();
        return;
    }
    if (!renderGpsLoss(Date.now(), true)) updateCarInfo(geoErrorMessage(error));
}

// ───────────────────────── Session ─────────────────────────

function startAcquisition() {
    if (!navigator.geolocation) {
        setStatus('error', 'La géolocalisation n’est pas supportée par ce navigateur.');
        return;
    }
    if (typeof window.resetFakeGpsStartTime === 'function') window.resetFakeGpsStartTime();
    if (CAR.watchId === null) {
        CAR.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
            enableHighAccuracy: true,
            maximumAge: CAR_TRACKING_CONFIG.geolocationMaximumAgeMs,
            timeout: CAR_TRACKING_CONFIG.geolocationTimeoutMs
        });
    }
    if (!CAR.freshnessInterval) {
        CAR.freshnessInterval = setInterval(() => renderGpsLoss(), CAR_TRACKING_CONFIG.freshnessCheckMs);
    }
}

function stopAcquisition() {
    if (CAR.watchId !== null) navigator.geolocation?.clearWatch(CAR.watchId);
    if (CAR.freshnessInterval) clearInterval(CAR.freshnessInterval);
    CAR.watchId = null;
    CAR.freshnessInterval = null;
}

function renderHome() {
    renderCarHome({
        routeKey: SESSION.draftConfig.routeKey,
        preview: routePreview(SESSION.draftConfig.routeKey),
        action: getHomeAction(SESSION, isDraftReady()),
        sessionActive: SESSION.session.active
    });
}

function syncView() {
    renderCarNavigation(SESSION.view, SESSION.session.active);
    renderHome();
    renderTracking({ relayout: true });
}

/** Chaque commande de l'accueil ne modifie que l'itinéraire provisoire. */
function updateDraft(routeKey) {
    if (!CAR_ROUTES[routeKey]) return;
    setDraft(SESSION, { routeKey });
    saveCarSettings(SESSION, localStorage);
    ensureRoute(routeKey);
    renderHome();
}

function onPrimaryAction() {
    const action = getHomeAction(SESSION, isDraftReady());
    if (action.mode === 'launch') {
        if (!launchSession(SESSION, isDraftReady()).ok) { renderHome(); return; }
        installRoute(SESSION.appliedConfig.routeKey);
        resetAcquisition();
        startAcquisition();
    } else if (action.mode === 'apply') {
        const result = applyDraft(SESSION, isDraftReady());
        if (!result.ok) { renderHome(); return; }
        if (result.change === 'route') {
            installRoute(SESSION.appliedConfig.routeKey);
            updateCarInfo('Itinéraire changé : progression remise à zéro, localisation conservée.');
        }
    } else {
        showView(SESSION, 'tracking');
    }
    syncView();
}

function onSecondaryAction() {
    const action = getHomeAction(SESSION, isDraftReady());
    if (action.secondary === 'cancel') {
        revertDraft(SESSION);
        saveCarSettings(SESSION, localStorage);
        renderHome();
    } else if (action.secondary === 'end') {
        el('end-session').showModal();
    }
}

function endSession() {
    stopAcquisition();
    stopSession(SESSION);
    resetRouteTracking();
    resetAcquisition();
    syncView();
}

document.addEventListener('DOMContentLoaded', () => {
    if (leavingForOtherMode) return;
    markDeviceClass();

    restoreCarSettings(SESSION, CAR_ROUTES, localStorage);
    ensureRoute(SESSION.draftConfig.routeKey);

    el('route-choices').addEventListener('change', event => {
        if (event.target.matches('input[type="radio"]')) updateDraft(event.target.value);
    });
    el('reverse-btn').addEventListener('click', () => updateDraft(reverseRouteKey(CAR_ROUTES, SESSION.draftConfig.routeKey)));
    el('start-btn').addEventListener('click', onPrimaryAction);
    el('secondary-btn').addEventListener('click', onSecondaryAction);
    el('settings-btn').addEventListener('click', () => {
        showView(SESSION, 'home');
        syncView();
    });
    el('confirm-end-btn').addEventListener('click', () => {
        el('end-session').close();
        endSession();
    });
    initModeSwitch({ mode: 'car', isSessionActive: () => SESSION.session.active, endSession });

    el('details-btn').addEventListener('click', () => {
        el('trip-details').showModal();
        renderCarDetails();
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

    // Observe la surface réellement disponible : rotation, barres iOS,
    // redimensionnement du dialogue.
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
});
