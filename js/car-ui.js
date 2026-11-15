// js/car-ui.js
// Rendu DOM du mode voiture (car.html) : accueil, cockpit et carrousel routier.
// La mise en page, le carrousel (carousel-view.js) et le profil de vitesse
// (speed-profile-view.js) sont ceux du train ; restent ici les contenus propres
// à la route — secteurs, repères typés, ouvrages d'art, position estimée — et
// l'absence de tout horaire.

import { CAR_ROUTES, CAR_TRACKING_CONFIG } from './car-config.js';
import { progressBetweenWaypoints, resolveWaypointTarget } from './car-route.js';
import { averageSpeedKmh, listRoutePairs, routeEndpoints } from './car-session.js';
import { el, escapeHtml, kmText, renderHomeActionButtons, setText, showInfo } from './app-shell.js';
import { createCarouselView } from './carousel-view.js';
import { createSpeedProfileView } from './speed-profile-view.js';
import { formatPk } from './linearref.js';
// Réglages de rendu communs aux deux cockpits.
import { CAROUSEL_ANIMATION_MS, CAROUSEL_HERO_RATIO, INFO_DISPLAY_MS, PROFILE_MAX_COLUMNS, PROFILE_RECENT_WINDOW_MS } from './train-config.js';

// Icônes Font Awesome 5 par type de point de passage.
const WAYPOINT_ICONS = {
    sortie:    'fas fa-sign-out-alt',
    echangeur: 'fas fa-random',
    aire:      'fas fa-parking',
    col:       'fas fa-mountain',
    viaduc:    'fas fa-archway',
    tunnel:    'fas fa-mountain',
    peage:     'fas fa-euro-sign',
    etape:     'fas fa-map-pin',
    depart:    'fas fa-flag',
    arrivee:   'fas fa-flag-checkered'
};

// Points « forts » du carrousel : nœud en anneau et nom lisible même loin
// devant. Réservé aux endroits où l'on s'arrête vraiment — sorties,
// échangeurs et ouvrages restent le fil de la route.
const STRONG_WAYPOINT_TYPES = ['depart', 'arrivee', 'peage'];

export function waypointIconHtml(type) {
    const cls = WAYPOINT_ICONS[type];
    return cls ? `<i class="${cls} wp-icon" aria-hidden="true"></i>` : '';
}

export function tunnelImageHtml(className = '') {
    const classes = ['tunnel-image', className].filter(Boolean).join(' ');
    return `<img src="assets/tunnel.png" class="${classes}" alt="Tunnel">`;
}

/**
 * Clé d'état de l'afficheur de vitesse : deux rendus successifs partageant la
 * même clé sont identiques au pixel près.
 * @param {object} data - état de suivi du mode voiture
 * @param {{unreliableAsLost?: boolean}} options - le compteur n'affiche aucune
 *        valeur dès que la vitesse n'est pas fiable.
 */
export function speedDisplayKey(data, { unreliableAsLost = false } = {}) {
    if (data.inTunnel) return `tunnel:${data.tunnelName || ''}`;
    if (data.gpsLost || (unreliableAsLost && !data.speedReliable)) return 'lost';
    return `speed:${Math.round(data.speedKmh)}:${data.speedReliable ? 'ok' : '?'}`;
}

/**
 * N'écrit dans le DOM que si l'affichage change réellement. La boucle de
 * fraîcheur rejoue le rendu deux fois par seconde, y compris à l'arrêt du
 * signal : réécrire l'innerHTML recréerait l'<img> du tunnel à chaque passage,
 * ce qui la fait scintiller.
 */
function renderSpeedDisplay(node, key, html) {
    if (!node || node.dataset.speedKey === key) return;
    node.dataset.speedKey = key;
    node.innerHTML = html;
}

// Affichage en kilomètres entiers : la décimale n'apporte rien sur une
// distance restante.
export function formatRemainingDistance(km) {
    if (!Number.isFinite(km) || km < 0) return '—';
    return `${Math.round(km)} km`;
}

/**
 * Distance courte, en mètres sous le kilomètre : à l'intérieur d'un ouvrage
 * d'art, « 0.3 km » restant à parcourir est moins parlant que « 300 m ».
 */
export function formatStructureDistance(km) {
    if (!Number.isFinite(km) || km < 0) return '—';
    return km < 1 ? `${Math.round(km * 1000)} m` : `${kmText(km)} km`;
}

/** Barre de progression le long d'un ouvrage (0 → 1), bornée. */
export function structureProgressPercent(progress) {
    if (!Number.isFinite(progress)) return 0;
    return Math.max(0, Math.min(1, progress)) * 100;
}

/**
 * Classes d'un repère du carrousel.
 * @param {number} i - index du repère
 * @param {number} currentIdx - dernier repère franchi (le suivant est le point héros)
 */
export function carPointClass(i, currentIdx, wp, onStructure = false, lastIdx = null) {
    let cls = 'train-point';
    // Les deux extrémités du trajet sont repérées par leur POSITION : selon
    // que l'itinéraire se termine sur un leg 'points' ou sur un repère
    // synthétique, le terminus est typé 'etape' ou 'arrivee'.
    const isTerminus = i === 0 || (Number.isInteger(lastIdx) && i === lastIdx);
    if (isTerminus || (wp && STRONG_WAYPOINT_TYPES.includes(wp.type))) cls += ' stop';
    if (i === currentIdx) cls += ' active';
    else if (i === currentIdx + 1) cls += ' next';
    else if (i < currentIdx) cls += ' past';
    // Franchissement en cours : le point héros reste l'ouvrage, signalé par
    // une pulsation qui le distingue d'un point simplement à venir.
    if (onStructure && i === currentIdx + 1) cls += ' on-structure';
    return cls;
}

export const updateCarInfo = message => showInfo(message, INFO_DISPLAY_MS);

// ───────────────────────── Accueil ─────────────────────────

const PREVIEW_MESSAGES = {
    loading: 'Chargement de l’itinéraire…',
    'no-route': 'Choisissez un trajet.'
};

let renderedPreviewKey = '';

/**
 * @param {object} home
 * @param {string} home.routeKey - itinéraire provisoire
 * @param {{status:'loading'|'ok'|'error'|'no-route', totalKm?:number, sectors?:Array, message?:string}} home.preview
 * @param {object} home.action - getHomeAction (car-session.js)
 * @param {boolean} home.sessionActive
 */
export function renderCarHome({ routeKey, preview, action, sessionActive }) {
    const pairs = listRoutePairs(CAR_ROUTES);
    const choices = el('route-choices');
    if (choices.dataset.key !== routeKey) {
        choices.dataset.key = routeKey;
        const focused = document.activeElement?.dataset?.pair;
        choices.innerHTML = `<fieldset class="segments"><legend class="sr-only">Trajet</legend>${pairs.map((pair, index) => `<label><input type="radio" name="route-pair" value="${escapeHtml(pair.keys[0])}" data-pair="${index}" ${pair.keys.includes(routeKey) ? 'checked' : ''}><span>${escapeHtml(pair.label)}</span></label>`).join('')}</fieldset>`;
        if (focused != null) choices.querySelector(`[data-pair="${focused}"]`)?.focus({ preventScroll: true });
    }

    const ends = routeEndpoints(CAR_ROUTES, routeKey);
    const ready = preview.status === 'ok';
    el('route-summary').hidden = !ends;
    setText('route-notice', ready ? '' : (preview.message || PREVIEW_MESSAGES[preview.status] || ''));
    el('route-notice').hidden = ready;
    setText('origin-name', ends?.origin || 'Départ');
    setText('destination-name', ends?.destination || 'Arrivée');
    el('reverse-btn').hidden = !pairs.some(pair => pair.keys.includes(routeKey) && pair.keys.length > 1);
    setText('route-meta', ready ? `${kmText(Math.round(preview.totalKm))} km` : '');

    const previewKey = `${routeKey}|${preview.status}`;
    if (renderedPreviewKey !== previewKey) {
        // Un changement de sens rejoue l'animation de retournement.
        const flipped = renderedPreviewKey && renderedPreviewKey.split('|')[0] !== routeKey;
        renderedPreviewKey = previewKey;
        el('route-sectors').innerHTML = ready ? preview.sectors.map(sector =>
            `<li><i class="line-dot" aria-hidden="true"></i><span>${escapeHtml(sector.name)}</span><small>${kmText(Math.round(sector.toKm - sector.fromKm))} km</small></li>`).join('') : '';
        if (flipped) {
            const line = el('route-summary');
            line.classList.remove('reversed');
            void line.offsetWidth;
            line.classList.add('reversed');
        }
    }

    setText('journey-summary', ready && ends
        ? `${ends.origin} → ${ends.destination} · ${kmText(Math.round(preview.totalKm))} km · ${preview.sectors.length} secteurs`
        : 'Votre route commence ici.');
    renderHomeActionButtons(action);
    setText('draft-status', action.mode === 'apply'
        ? 'Itinéraire non appliqué. Le suivi continue sur le trajet précédent.'
        : sessionActive ? 'La localisation continue pendant les réglages.'
            : 'Progression et distances, sans horaire ni heure d’arrivée.');
}

// ───────────────────────── Cockpit ─────────────────────────

const profileView = createSpeedProfileView({
    maxKmh: CAR_TRACKING_CONFIG.gaugeMaxSpeedKmh, maxColumns: PROFILE_MAX_COLUMNS, recentWindowMs: PROFILE_RECENT_WINDOW_MS,
    accent: '#1f3a6e', darkCursor: '#9db7ee'
});
let carousel = null;
// Créé à la première utilisation : le module peut être chargé avant le DOM.
const carouselView = () => carousel ||= createCarouselView({
    carousel: el('train-carousel'), points: el('train-points'), recenterButton: el('recenter-btn'),
    heroRatio: CAROUSEL_HERO_RATIO, animationMs: CAROUSEL_ANIMATION_MS
});
export const pauseCarouselFollow = () => carouselView().pause();
export const recenterCarousel = () => carouselView().recenter();

const PROFILE_HELP = 'Survolez ou touchez le profil pour lire une mesure. Au clavier, utilisez les flèches.';
let currentModel = null;
let profileRange = 'trip';
let previousView = 'home';
let renderedRouteKey = null;
let renderedNextIdx = null;
let renderedSector = null;
let renderedLogKey = '';

/** Affiche la vue demandée ; hors session, oublie tout rendu du suivi précédent. */
export function renderCarNavigation(view, sessionActive) {
    const tracking = view === 'tracking';
    if (!sessionActive) {
        currentModel = null;
        renderedRouteKey = null;
        renderedSector = null;
        profileView.reset();
        carouselView().reset();
        setProfileRange('trip');
    }
    el('home-view').hidden = tracking;
    el('tracking-view').hidden = !tracking;
    el('session-status').hidden = !sessionActive;
    document.body.classList.toggle('tracking-active', tracking);
    if (!tracking) carouselView().cancelScroll();
    if (view !== previousView) {
        (tracking ? el('tracking-view') : el('home-title')).focus({ preventScroll: true });
        previousView = view;
    }
}

/** Étendue du profil détaillé : tout le trajet (axe en km) ou fenêtre récente (axe en temps). */
export function setProfileRange(range) {
    const next = range === 'recent' ? 'recent' : 'trip';
    document.querySelectorAll('[data-profile-range]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.profileRange === next));
    });
    if (next === profileRange) return;
    profileRange = next;
    el('profile-readout').hidden = true;
    setText('details-readout', PROFILE_HELP);
    if (!currentModel) return;
    drawProfile(el('speed-profile'), true);
    if (el('trip-details').open) drawProfile(el('details-profile'));
}

function drawProfile(canvas, dark = false) {
    const profile = currentModel.profile;
    const drawn = profileView.draw(canvas, profile, { dark, range: profileRange });
    if (!drawn) return;
    canvas.setAttribute('aria-label', drawn.recent
        ? `Vitesse des ${PROFILE_RECENT_WINDOW_MS / 60_000} dernières minutes, axe en temps. ${drawn.points} mesures.`
        : `Vitesse mesurée sur ${kmText(profile.totalKm)} kilomètres. Maximum ${Math.round(profile.maxKmh)} km/h. Les tunnels et pertes de signal ne sont pas tracés.`);
}

export function inspectSpeedProfile(canvas, event) {
    profileView.inspect(canvas, event, el(canvas.id === 'details-profile' ? 'details-readout' : 'profile-readout'));
}

function renderGauge(data) {
    const gaugeMax = CAR_TRACKING_CONFIG.gaugeMaxSpeedKmh;
    const key = data ? speedDisplayKey(data, { unreliableAsLost: true }) : 'lost';
    const measured = key.startsWith('speed:');
    el('gauge-value').style.strokeDasharray = `${measured ? Math.min(1, data.speedKmh / gaugeMax) * 222 : 0} 333`;
    if (data?.inTunnel) {
        renderSpeedDisplay(el('speed-value'), key, tunnelImageHtml());
        setText('speed-unit', 'ESTIMÉ');
        el('speed-gauge').setAttribute('aria-label', `${data.tunnelName || 'Tunnel'} : vitesse non mesurée, progression estimée`);
    } else if (!measured) {
        renderSpeedDisplay(el('speed-value'), key, '—');
        setText('speed-unit', data?.gpsLost ? 'SIGNAL PERDU' : 'KM/H');
        el('speed-gauge').setAttribute('aria-label', 'Vitesse indisponible');
    } else {
        renderSpeedDisplay(el('speed-value'), key, String(Math.round(data.speedKmh)));
        setText('speed-unit', 'KM/H');
        el('speed-gauge').setAttribute('aria-label', `${Math.round(data.speedKmh)} kilomètres par heure`);
    }
}

function renderSector(name) {
    const node = el('sector-name');
    const text = name || '—';
    if (node.textContent === text) return;
    node.textContent = text;
    // Transition discrète au changement de secteur, pas à l'apparition du premier.
    if (renderedSector && name) {
        node.classList.remove('swap');
        void node.offsetWidth;
        node.classList.add('swap');
    }
    renderedSector = name || renderedSector;
}

/** Distance vers le repère visé, ou restant à parcourir sur l'ouvrage en cours. */
function targetDistanceText(target, capitalized = false) {
    if (!target.nextWaypoint) return '';
    return target.onStructure
        // « fin » plutôt que « sortie » : sur autoroute, une sortie est un
        // échangeur, pas l'extrémité d'un ouvrage.
        ? `${capitalized ? 'Fin' : 'fin'} dans ${formatStructureDistance(target.nextDistanceKm)}`
        : `${kmText(target.nextDistanceKm)} km`;
}

function renderCarousel(model, target, relayout) {
    const container = el('train-points');
    const waypoints = model.waypoints;
    const data = model.data;
    const lastIdx = waypoints.length - 1;
    let nextIdx = target.nextIndex ?? waypoints.length;
    let onStructure = target.onStructure;
    if (!data) nextIdx = 0;
    if (data?.arrived) { nextIdx = waypoints.length; onStructure = false; }
    const currentIdx = nextIdx - 1;

    const routeChanged = renderedRouteKey !== model.routeKey;
    if (routeChanged) {
        renderedRouteKey = model.routeKey;
        renderedLogKey = '';
        el('profile-readout').hidden = true;
        // Sous-ligne : longueur de l'ouvrage uniquement. Le kilométrage
        // officiel est hétérogène selon les concessions et ferait doublon avec
        // la distance calculée le long du trajet. La jauge n'existe que pour
        // les ouvrages ; le CSS ne la révèle que pendant leur franchissement.
        container.innerHTML = waypoints.map((wp, index) => `<article class="train-point" data-index="${index}"><i class="point-dot" aria-hidden="true"></i><div class="point-name">${waypointIconHtml(wp.type)}${escapeHtml(wp.name)}</div><div class="point-meta">${Number.isFinite(wp.lengthM) ? `<span>${wp.lengthM} m</span>` : ''}<span class="point-distance"></span></div><div class="point-detail"></div>${Number.isFinite(wp.lengthM) ? '<div class="point-gauge"><span></span></div>' : ''}</article>`).join('') + '<i class="train-cursor" aria-hidden="true" hidden></i>';
    }
    const idxChanged = renderedNextIdx !== nextIdx;
    renderedNextIdx = nextIdx;

    waypoints.forEach((wp, index) => {
        const node = container.children[index];
        const className = carPointClass(index, currentIdx, wp, onStructure, lastIdx);
        if (node.className !== className) node.className = className;
        if (index === currentIdx && data) node.setAttribute('aria-current', 'step');
        else node.removeAttribute('aria-current');
        const isNext = index === nextIdx;
        const distance = node.querySelector('.point-distance');
        const distanceText = data && !isNext && wp.routeKm > data.doneKm ? `à ${kmText(wp.routeKm - data.doneKm)} km` : '';
        if (distance.textContent !== distanceText) distance.textContent = distanceText;
        const detail = node.querySelector('.point-detail');
        const detailText = isNext && data ? targetDistanceText(target, true)
            : data?.arrived && index === lastIdx ? 'Arrivée' : '';
        if (detail.textContent !== detailText) detail.textContent = detailText;
        if (isNext && onStructure) {
            const fill = node.querySelector('.point-gauge span');
            if (fill) fill.style.width = `${structureProgressPercent(target.structureProgress).toFixed(1)}%`;
        }
    });

    // Avancement entre le repère franchi et le suivant. Sur un ouvrage, le
    // ratio sature à 1 : la tête se pose sur son nœud et c'est la jauge de
    // franchissement qui porte l'avancement fin (progressBetweenWaypoints).
    carouselView().layout({
        index: currentIdx,
        ratio: data ? progressBetweenWaypoints(waypoints, currentIdx, nextIdx, data.doneKm) : 0,
        located: !!data
    }, !routeChanged && idxChanged && !relayout);
}

/**
 * Rend le cockpit depuis le modèle de l'orchestrateur ; aucun abonnement GPS
 * ici. `model.data` est null tant qu'aucune position n'a été accrochée.
 * @param {object} model
 * @param {string} model.routeKey
 * @param {Array} model.waypoints - route.waypoints (triés par routeKm)
 * @param {number} model.totalKm
 * @param {object|null} model.data - dernier état de suivi (mesuré ou estimé)
 * @param {{signal:string, text:string}} model.status - état du signal GPS
 * @param {object} model.stats - createTripStats (car-session.js)
 * @param {object} model.profile - profil de vitesse (mesures uniquement)
 * @param {{lat:number, lon:number}|null} model.lastFix - dernière position mesurée
 */
export function renderCarTracking(model, { relayout = false } = {}) {
    currentModel = model;
    const data = model.data;
    const estimated = !!data && (data.inTunnel || data.gpsLost);
    el('tracking-view').toggleAttribute('data-estimated', estimated);
    setText('tracking-route', CAR_ROUTES[model.routeKey]?.label || 'Votre trajet');

    renderGauge(data);
    renderSector(data?.arrived ? 'Arrivée' : data?.sector);

    const ratio = data && model.totalKm > 0 ? Math.max(0, Math.min(1, data.doneKm / model.totalKm)) : 0;
    const percent = Math.round(ratio * 100);
    setText('progress-chip', data ? `${percent} %` : 'En attente');
    setText('remaining-text', data ? `${formatRemainingDistance(data.remainingKm)} restants` : '');

    const target = resolveWaypointTarget(model.waypoints, data ? data.doneKm : NaN);
    const nextLine = el('next-line');
    const nextKey = target.nextWaypoint ? `${target.nextWaypoint.name}|${targetDistanceText(target)}` : data?.arrived ? 'arrived' : '';
    if (nextLine.dataset.key !== nextKey) {
        nextLine.dataset.key = nextKey;
        nextLine.innerHTML = target.nextWaypoint
            ? `${waypointIconHtml(target.nextWaypoint.type)}<b>${escapeHtml(target.nextWaypoint.name)}</b> · ${targetDistanceText(target)}`
            : data?.arrived ? 'Vous êtes arrivé.' : '';
    }

    setText('km-done', data ? kmText(data.doneKm) : '—');
    setText('km-left', data ? kmText(data.remainingKm) : '—');
    const avg = averageSpeedKmh(model.stats);
    setText('speed-average', avg > 0 ? Math.round(avg) : '—');
    setText('speed-max', model.stats.maxKmh > 0 ? Math.round(model.stats.maxKmh) : '—');

    setText('location-status', model.status.text);
    el('location-status').dataset.signal = model.status.signal;

    el('journey-progress').setAttribute('aria-valuenow', percent);
    el('journey-progress').firstElementChild.style.width = `${ratio * 100}%`;
    setText('progress-label', !data ? 'Position en attente'
        : `${kmText(data.doneKm)} / ${kmText(model.totalKm)} km · ${percent} %${estimated ? ' · position estimée' : ''}`);

    renderCarousel(model, target, relayout);
    drawProfile(el('speed-profile'), true);
    if (el('trip-details').open) renderCarDetails();
}

/** Informations détaillées du parcours : position, compteurs, profil et repères. */
export function renderCarDetails() {
    if (!currentModel) return;
    const { data, stats, status, lastFix, waypoints, totalKm } = currentModel;
    drawProfile(el('details-profile'));
    const position = data && data.pk != null ? ` · ${data.legLabel || ''} PK ${formatPk(data.pk)}` : data?.legLabel ? ` · ${data.legLabel}` : '';
    setText('details-location', `${status.text}${position}${lastFix ? ` · dernière mesure ${lastFix.lat.toFixed(5)}, ${lastFix.lon.toFixed(5)}` : ''}`);
    const avg = averageSpeedKmh(stats);
    const figures = [
        ['Parcourus', data ? `${kmText(data.doneKm)} km` : '—'],
        ['Restants', `${kmText(data ? data.remainingKm : totalKm)} km`],
        ['Vitesse moyenne', avg > 0 ? `${Math.round(avg)} km/h` : '—'],
        ['Vitesse maximale', stats.maxKmh > 0 ? `${Math.round(stats.maxKmh)} km/h` : '—']
    ];
    const statsKey = figures.join('|');
    if (el('details-stats').dataset.key !== statsKey) {
        el('details-stats').dataset.key = statsKey;
        el('details-stats').innerHTML = figures.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    }

    // Le tableau n'est reconstruit qu'au changement de repère visé : entre
    // deux, seules les distances bougent et elles se lisent dans le carrousel.
    const target = resolveWaypointTarget(waypoints, data ? data.doneKm : NaN);
    const logKey = `${currentModel.routeKey}|${target.nextIndex}|${target.onStructure}|${!!data}`;
    if (logKey === renderedLogKey) return;
    renderedLogKey = logKey;
    el('waypoint-log').innerHTML = waypoints.map((wp, index) => {
        const current = data && index === target.nextIndex;
        const passed = data && !current && wp.routeKm <= data.doneKm;
        const state = current ? (target.onStructure ? 'En cours de franchissement' : 'Prochain repère') : passed ? 'Franchi' : 'À venir';
        return `<tr class="${current ? 'current' : passed ? 'past' : ''}"><th scope="row">${waypointIconHtml(wp.type)}${escapeHtml(wp.name)}${Number.isFinite(wp.lengthM) ? ` · ${wp.lengthM} m` : ''}</th><td>${kmText(wp.routeKm)}</td><td>${state}</td></tr>`;
    }).join('');
}
