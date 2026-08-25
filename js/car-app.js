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

import { STATE } from './state.js';
import { CAR_ROUTES, CAR_TRACKING_CONFIG } from './car-config.js';
import { loadDataset, DatasetError } from './csv.js';
import {
    buildCarRoute,
    estimateDeclaredTunnelProgress,
    findSector,
    listDeclaredTunnels,
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
import { populateCarRouteSelect, updateCarWidget, updateCarHUD, updateCarInfo } from './car-ui.js';

const CAR = {
    route: null,            // { points, cumKm, totalKm, legs, waypoints } (buildCarRoute)
    routeKey: null,         // clé CAR_ROUTES sélectionnée
    routeCfg: null,         // entrée CAR_ROUTES (secteurs — findSector)
    lastSegmentIndex: null, // garde-fou séquentiel : ne recule jamais
    speedHistory: [],       // [{ v, reliable }] pour le graphe du HUD
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

function appendSpeedSample(speedKmh, reliable, timestamp = Date.now()) {
    CAR.speedHistory.push({ v: speedKmh, reliable, ts: timestamp });
    if (CAR.speedHistory.length > CAR_TRACKING_CONFIG.speedHistoryMax) {
        CAR.speedHistory.shift();
    }
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
        speedHistory: CAR.speedHistory,
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
    const graceChanged = tunnelActive && Boolean(estimate.inExitGrace) !== CAR.tunnelInGrace;
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
        updateCarWidget(staleData);
        updateCarHUD(staleData);
        CAR.lastRenderData = staleData;
    }

    if (graceChanged && estimate.inExitGrace) {
        updateCarInfo(`<strong>Sortie de ${estimate.tunnel.name}</strong> — recherche du GPS pendant 10 secondes.`);
    } else if (firstTunnelRender) {
        updateCarInfo(`<strong>${estimate.tunnel.name}</strong> — progression estimée à la vitesse d’entrée.`);
    } else if (firstLostRender) {
        updateCarInfo('Signal GPS perdu — progression suspendue.');
    }
    return tunnelActive ? 'tunnel' : 'lost';
}

async function loadCarRoute(routeKey) {
    const cfg = CAR_ROUTES[routeKey];
    if (!cfg) throw new Error(`Itinéraire inconnu : ${routeKey}`);

    // Chargement des datasets déclarés par l'itinéraire (descripteurs JSON)
    const datasetsById = {};
    for (const url of cfg.datasets || []) {
        const ds = await loadDataset(url);
        datasetsById[ds.descriptor.id] = ds;
    }

    const effectiveCfg = applyCarWaypointOverrides(cfg, loadCarWaypointOverrides());
    CAR.route = buildCarRoute(effectiveCfg, datasetsById);
    CAR.routeKey = routeKey;
    CAR.routeCfg = effectiveCfg;
    CAR.lastSegmentIndex = null;
    CAR.speedHistory = [];
    CAR.arrived = false;
    CAR.trackingStartedAt = Date.now();
    CAR.lastFixAt = 0;
    CAR.lastKnownSpeedKmh = 0;
    CAR.lastLostSampleAt = 0;
    CAR.gpsLost = false;
    CAR.inTunnel = false;
    CAR.tunnelInGrace = false;
    CAR.absenceMode = null;
    CAR.absenceFrozenDoneKm = null;
    CAR.lastRenderData = null;
    CAR.lastFixRenderData = null;
    engine.reset();

    // Compat fakeGeoSim (dev) : la simulation lit STATE.currentRoute et les
    // durationEffective par point — buildCarRoute les fournit. Les bornes des
    // tunnels lui permettent en plus de se taire à l'intérieur, seule façon de
    // rejouer la coupure de signal sans monter en voiture. Sans simulateur
    // chargé, personne ne lit cette valeur.
    STATE.currentRoute = CAR.route.points;
    window.FAKE_GPS_SIGNAL_GAPS = listDeclaredTunnels(CAR.route);
}

function onPosition(position) {
    if (!CAR.route) return;

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
    if (speedReliable) CAR.lastKnownSpeedKmh = speedKmh;
    appendSpeedSample(speedKmh, speedReliable, fixTimestamp);

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
            updateCarInfo(`Position ${lat.toFixed(5)}, ${lon.toFixed(5)} hors itinéraire — en attente d'accrochage.`);
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
        speedHistory: CAR.speedHistory,
        gpsLost: false,
        inTunnel: false,
        tunnelName: null,
        sector,
        arrived: CAR.arrived
    };
    CAR.lastRenderData = renderData;
    CAR.lastFixRenderData = renderData;
    updateCarWidget(renderData);
    updateCarHUD(renderData);

    let infoHtml = `<strong>Position :</strong> ${lat.toFixed(5)}, ${lon.toFixed(5)}.`;
    if (Number.isFinite(accuracyMeters)) {
        infoHtml += ` (±${Math.round(accuracyMeters)} m)`;
    }
    if (offRoute) {
        infoHtml += ' Hors itinéraire — position conservée sur le dernier tronçon validé.';
    }
    updateCarInfo(infoHtml);
}

function onGeoError(error) {
    // Un refus de permission n'est pas un tunnel ; TIMEOUT et
    // POSITION_UNAVAILABLE correspondent bien à une disette de signal.
    if (error?.code === 1) {
        updateCarInfo(geoErrorMessage(error));
        return;
    }
    if (!renderGpsLoss(Date.now(), true)) updateCarInfo(geoErrorMessage(error));
}

async function startTracking() {
    const select = document.getElementById('car-route-select');
    const routeKey = select?.value;
    if (!routeKey) {
        alert('Choisissez un itinéraire.');
        return;
    }

    try {
        await loadCarRoute(routeKey);
    } catch (e) {
        console.error('loadCarRoute error:', e);
        if (e instanceof DatasetError) {
            updateCarInfo(
                `Dataset indisponible (${e.code}) : ${e.message}<br>` +
                '<small>Déposez le fichier CSV et ajustez son descripteur dans <code>data/datasets/</code>.</small>'
            );
        } else {
            updateCarInfo(`Erreur de construction de l'itinéraire : ${e.message}`);
        }
        return;
    }

    document.body.classList.add('tracking-active');
    updateCarInfo(`Itinéraire chargé : ${CAR.route.points.length} points, ${CAR.route.totalKm.toFixed(1)} km. En attente du GPS…`);

    if (!navigator.geolocation) {
        updateCarInfo("La géolocalisation n'est pas supportée par ce navigateur.");
        return;
    }

    if (typeof window.resetFakeGpsStartTime === 'function') {
        window.resetFakeGpsStartTime();
    }
    if (CAR.watchId === null) {
        CAR.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
            enableHighAccuracy: true,
            maximumAge: CAR_TRACKING_CONFIG.geolocationMaximumAgeMs,
            timeout: CAR_TRACKING_CONFIG.geolocationTimeoutMs
        });
    }
    if (!CAR.freshnessInterval) {
        CAR.freshnessInterval = setInterval(
            () => renderGpsLoss(),
            CAR_TRACKING_CONFIG.freshnessCheckMs
        );
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Le HUD paysage adapte ses tailles hors iPhone (mêmes classes que le rail).
    // Même raison que dans app.js : l'UA d'une WebView hôte peut omettre
    // « iPhone », navigator.platform non.
    const isIPhone = /iPhone|iPod/i.test(navigator.userAgent || '')
        || navigator.platform === 'iPhone' || navigator.platform === 'iPod touch';
    document.body.classList.toggle('iphone-device', isIPhone);
    document.body.classList.toggle('non-iphone-device', !isIPhone);

    populateCarRouteSelect();
    const startBtn = document.getElementById('car-start-btn');
    if (startBtn) startBtn.addEventListener('click', startTracking);
});
