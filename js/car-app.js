// js/car-app.js
// Orchestrateur du mode voiture (car.html) — suivi Mâcon → Combloux.
//
// Réutilise le cœur partagé avec le rail :
// - csv.js / linearref.js : datasets PK-PR décrits par JSON (aucun recodage
//   quand le CSV réel arrive) ;
// - position-engine.js : chaîne de filtres GPS (précision, anti-téléportation,
//   vitesse médiane, plancher de bruit, anti-pic) identique au rail ;
// - functions.js : matching de segment (fenêtre glissante, tolérance GPS),
//   AVEC fallback latitude DÉSACTIVÉ — l'itinéraire est globalement ouest-est,
//   un fallback cardinal serait faux par construction. Le repli en cas d'échec
//   de matching est purement séquentiel : on reste sur le dernier index validé.
//
// Pas de notion d'horaire/retard : affichage progression + ETA (vitesse
// moyenne glissante, plancher 20 km/h).

import { STATE } from './state.js';
import { CAR_ROUTES } from './car-config.js';
import { loadDataset, DatasetError } from './csv.js';
import { buildCarRoute, computeEtaSeconds, findSector } from './car-route.js';
import { createPositionEngine } from './position-engine.js';
import {
    computeSegmentIndexAndDistance,
    projectPositionOnRouteSegment,
    findNearestSegmentIndex
} from './functions.js';
import { geoErrorMessage } from './geo.js';
import { populateCarRouteSelect, updateCarWidget, updateCarHUD, updateCarInfo } from './car-ui.js';

const ARRIVAL_THRESHOLD_KM = 0.2;   // même seuil que le rail
const MAX_CAR_SPEED_KMH = 150;
const SPEED_HISTORY_MAX = 600;      // 10 min à 1 pt/s

const CAR = {
    route: null,            // { points, cumKm, totalKm, legs, waypoints } (buildCarRoute)
    routeKey: null,         // clé CAR_ROUTES sélectionnée
    routeCfg: null,         // entrée CAR_ROUTES (secteurs — findSector)
    lastSegmentIndex: null, // garde-fou séquentiel : ne recule jamais
    speedHistory: [],       // [{ v, reliable }] pour l'ETA
    arrived: false,
    trackingInterval: null
};

const engine = createPositionEngine({
    maxSpeedKmh: MAX_CAR_SPEED_KMH,
    // fakeGeoSim accélère les positions ×N : la vitesse doit être re-divisée.
    speedDivisor: () => window.FAKE_GPS_SPEED_MULTIPLIER || 1
});

async function loadCarRoute(routeKey) {
    const cfg = CAR_ROUTES[routeKey];
    if (!cfg) throw new Error(`Itinéraire inconnu : ${routeKey}`);

    // Chargement des datasets déclarés par l'itinéraire (descripteurs JSON)
    const datasetsById = {};
    for (const url of cfg.datasets || []) {
        const ds = await loadDataset(url);
        datasetsById[ds.descriptor.id] = ds;
    }

    CAR.route = buildCarRoute(cfg, datasetsById);
    CAR.routeKey = routeKey;
    CAR.routeCfg = cfg;
    CAR.lastSegmentIndex = null;
    CAR.speedHistory = [];
    CAR.arrived = false;
    engine.reset();

    // Compat fakeGeoSim (dev) : la simulation lit STATE.currentRoute et les
    // durationEffective par point — buildCarRoute les fournit.
    STATE.currentRoute = CAR.route.points;
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

    CAR.speedHistory.push({ v: speedKmh, reliable: speedReliable });
    if (CAR.speedHistory.length > SPEED_HISTORY_MAX) CAR.speedHistory.shift();

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

    if (segmentIndex >= route.length - 2 && distanceToNextPointKm < ARRIVAL_THRESHOLD_KM) {
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
    // liste triée par km-route fournie par buildCarRoute.
    let nextWaypoint = null;
    let nextDistanceKm = null;
    for (const wp of CAR.route.waypoints) {
        if (wp.routeKm > doneKm) {
            nextWaypoint = wp;
            nextDistanceKm = wp.routeKm - doneKm;
            break;
        }
    }

    const sector = findSector(CAR.routeCfg, a?.legIndex, pk);
    const etaSeconds = computeEtaSeconds(remainingKm, CAR.speedHistory);

    updateCarWidget({
        legLabel: a?.legLabel ?? '',
        pk,
        line,
        nextWaypoint,
        nextDistanceKm,
        doneKm,
        remainingKm,
        totalKm: CAR.route.totalKm,
        speedKmh,
        speedReliable,
        etaSeconds,
        sector,
        arrived: CAR.arrived
    });

    updateCarHUD({
        routeKey: CAR.routeKey,
        waypoints: CAR.route.waypoints,
        doneKm,
        remainingKm,
        speedKmh,
        speedReliable,
        speedHistory: CAR.speedHistory,
        etaSeconds,
        sector,
        arrived: CAR.arrived
    });

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
    updateCarInfo(geoErrorMessage(error));
}

function requestPosition() {
    if (!navigator.geolocation) {
        updateCarInfo("La géolocalisation n'est pas supportée par ce navigateur.");
        return;
    }
    navigator.geolocation.getCurrentPosition(onPosition, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
    });
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

    if (typeof window.resetFakeGpsStartTime === 'function') {
        window.resetFakeGpsStartTime();
    }
    if (!CAR.trackingInterval) {
        CAR.trackingInterval = setInterval(requestPosition, 1000);
        requestPosition();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Le HUD paysage adapte ses tailles hors iPhone (mêmes classes que le rail).
    const isIPhone = /iPhone/i.test(navigator.userAgent || '');
    document.body.classList.toggle('iphone-device', isIPhone);
    document.body.classList.toggle('non-iphone-device', !isIPhone);

    populateCarRouteSelect();
    const startBtn = document.getElementById('car-start-btn');
    if (startBtn) startBtn.addEventListener('click', startTracking);
});
