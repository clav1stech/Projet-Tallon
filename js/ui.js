import { STATE } from './state.js';
import { MAIN_ROUTES } from './routes-config.js';
import { buildCockpitModel, buildCarouselModel, buildSpeedProfile } from './tracking-session.js';
import { computeSegmentRatio } from './functions.js';
import { alignDelayForDisplay, formatTime } from './utils.js';
import { formatPk } from './linearref.js';
import { el, escapeHtml, kmText, renderHomeActionButtons, setText, showInfo } from './app-shell.js';
import { createCarouselView } from './carousel-view.js';
import { createSpeedProfileView } from './speed-profile-view.js';
import { buildPointLabels } from './point-labels.js';
import { CAROUSEL_ANIMATION_MS, CAROUSEL_HERO_RATIO, DELTA_MAX_MINUTES, DELTA_MIN_MINUTES, INFO_DISPLAY_MS, MAX_TRAIN_SPEED_KMH, PROFILE_MAX_COLUMNS, PROFILE_RECENT_WINDOW_MS } from './train-config.js';

const clock = ts => Number.isFinite(ts) ? formatTime(new Date(ts)) : '––:––';
const duration = seconds => {
    const minutes = Math.max(0, Math.round(seconds / 60));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
};
const dateTime = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const delayText = ms => {
    const seconds = Math.round(Math.abs(ms) / 1000);
    return `${ms < 0 ? '−' : '+'}${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
};

/**
 * Résultat affiché à côté de l'horaire théorique d'un point de la timeline.
 * Mêmes seuils et même arrondi que la pilule et l'ETA (`alignDelayForDisplay`) :
 * l'heure affichée vaut toujours théorique + écart annoncé, à la minute près.
 * Un point futur au-delà du prochain n'affiche rien tant que le train est à l'heure.
 */
function pointOutcome(point, isNext) {
    const delayMs = point.observedTs != null ? alignDelayForDisplay(point.delayMs)
        : point.estimatedTs != null ? point.estimatedTs - point.theoreticalTs : null;
    if (delayMs == null) return { text: '', tone: '' };
    if (delayMs === 0) return point.observedTs != null || isNext ? { text: 'à l’heure', tone: 'ok' } : { text: '', tone: '' };
    const minutes = Math.round(Math.abs(delayMs) / 60_000);
    return {
        text: `${clock(point.theoreticalTs + delayMs)} (${delayMs > 0 ? '+' : '−'}${minutes} min)`,
        tone: delayMs > 0 ? 'late' : 'early'
    };
}

/** Les deux sens d'une même liaison viennent de MAIN_ROUTES, sans catalogue parallèle. */
export function populateRouteChoices(selectedKey = '') {
    const container = el('route-choices');
    const focus = document.activeElement?.dataset.focusKey;
    const groups = new Map();
    Object.entries(MAIN_ROUTES).forEach(([key, route]) => {
        const id = [route.startPointId, route.endPointId].sort().join('|');
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push({ key, ...route });
    });
    const selected = MAIN_ROUTES[selectedKey];
    const endpointCounts = new Map();
    Object.values(MAIN_ROUTES).forEach(route => {
        [route.startPointId, route.endPointId].forEach(id => endpointCounts.set(id, (endpointCounts.get(id) || 0) + 1));
    });
    const hub = [...endpointCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const selectedGroup = [...groups.values()].find(routes => routes.some(r => r.key === selectedKey));
    const groupHtml = [...groups.values()].map(routes => {
        const route = routes.find(r => selected && (r.endPointId === hub) === (selected.endPointId === hub)) || routes[0];
        const parts = routes[0].label.split(' → ');
        const label = parts.find(part => part !== 'Paris') || parts.join(' ↔ ');
        return `<label><input type="radio" name="route-group" value="${route.key}" data-focus-key="group-${routes[0].key}" ${routes === selectedGroup ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
    }).join('');
    const directions = selectedGroup ? `<fieldset class="segments"><legend class="sr-only">Sens du trajet</legend>${selectedGroup.map(route => `<label><input type="radio" name="route-direction" value="${route.key}" data-focus-key="direction-${route.key}" ${route.key === selectedKey ? 'checked' : ''}><span>${escapeHtml(route.label)}</span></label>`).join('')}</fieldset>` : '';
    container.innerHTML = `<fieldset class="segments"><legend class="sr-only">Liaison depuis ou vers Paris</legend>${groupHtml}</fieldset>${directions}`;
    if (focus) [...container.querySelectorAll('input')].find(input => input.dataset.focusKey === focus)?.focus({ preventScroll: true });
}

export function syncFormControls(draft) {
    populateRouteChoices(draft.mainRouteKey);
    el('departure-time').value = draft.departureTime;
    el('global-delta').min = DELTA_MIN_MINUTES;
    el('global-delta').max = DELTA_MAX_MINUTES;
    el('global-delta').value = Math.round(draft.globalDeltaSeconds / 60);
    syncLocationControls();
}

export function syncLocationControls() {
    const method = STATE.draftConfig.locationMethod;
    document.querySelectorAll('input[name="location-method"]').forEach(input => { input.checked = input.value === method; });
    setText('location-hint', method === 'sncf'
        ? (window.IS_SCRIPTABLE_BRIDGE ? 'WiFi SNCF via le bridge Scriptable.' : 'À bord, sur le réseau WiFi SNCF. Repli GPS si indisponible.')
        : 'Localisation de cet appareil.');
}

const SUMMARY_MESSAGES = {
    loading: 'Chargement des horaires…',
    'no-route': 'Choisissez une liaison pour préparer votre desserte.',
    'data-unavailable': 'Données de ligne indisponibles. Rechargez la page pour réessayer.',
    'no-departure': 'Indiquez l’heure de départ pour calculer les horaires.'
};

export function renderServiceSummary(summary) {
    const container = el('service-rest');
    const focusId = document.activeElement?.dataset.stopId;
    const hadFocus = container.contains(document.activeElement);
    el('service-summary').hidden = summary.stops.length === 0;
    setText('service-notice', SUMMARY_MESSAGES[summary.status] || '');
    el('service-notice').hidden = summary.status === 'ok';
    setText('departure-display', STATE.draftConfig.departureTime || '––:––');
    el('departure-display').parentNode.classList.toggle('missing', !STATE.draftConfig.departureTime);
    const first = summary.stops[0];
    setText('origin-name', first?.name || 'Gare de départ');
    setText('service-meta', summary.stops.length ? `${summary.intermediateStopCount ? `${summary.intermediateStopCount} arrêt${summary.intermediateStopCount > 1 ? 's' : ''}` : 'Direct'} · ${duration(summary.totalSeconds)}` : '');
    const nodes = [];
    for (let i = 1; i < summary.stops.length; i++) {
        const stop = summary.stops[i];
        const previous = summary.stops[i - 1];
        const options = summary.stopOptions.filter(option => !option.selected && option.routeIndex > previous.routeIndex && option.routeIndex < stop.routeIndex);
        nodes.push(`<div class="service-leg" style="--leg-weight:${stop.legSeconds}"><span></span><i class="line-dot" aria-hidden="true"></i><div class="leg-content"><small>${duration(stop.legSeconds)} · ${kmText(stop.legKm)} km</small>${options.length ? `<div class="optional-stops">${options.map(option => `<button type="button" data-stop-id="${escapeHtml(option.id)}" data-stop-action="add" aria-label="Ajouter l’arrêt ${escapeHtml(option.label)}">${escapeHtml(option.label)}</button>`).join('')}</div>` : ''}</div></div>`);
        nodes.push(`<div class="service-stop ${stop.role}"><time ${stop.timestamp != null ? `datetime="${new Date(stop.timestamp).toISOString()}"` : ''}>${stop.time || '––:––'}${stop.dayOffset > 0 ? `<sup>J+${stop.dayOffset}</sup>` : ''}</time><i class="line-dot" aria-hidden="true"></i><div><strong>${escapeHtml(stop.name)}</strong><small>${stop.role === 'terminus' ? 'Arrivée' : 'Arrêt commercial'}</small></div>${stop.role === 'stop' ? `<button type="button" class="remove-stop" data-stop-id="${escapeHtml(stop.id)}" data-stop-action="remove" aria-label="Retirer l’arrêt ${escapeHtml(stop.name)}">×</button>` : ''}</div>`);
    }
    container.innerHTML = nodes.join('');
    if (hadFocus) ([...container.querySelectorAll('button')].find(button => button.dataset.stopId === focusId) || el('departure-time')).focus({ preventScroll: true });
    setText('journey-summary', summary.status === 'ok' ? `${duration(summary.totalSeconds)} · ${kmText(summary.totalKm)} km · arrivée ${summary.stops.at(-1).time}${summary.stops.at(-1).dayOffset > 0 ? ` J+${summary.stops.at(-1).dayOffset}` : ''}` : 'Votre voyage commence ici.');
    const delta = STATE.draftConfig.globalDeltaSeconds / 60;
    el('delta-minus').disabled = delta <= DELTA_MIN_MINUTES;
    el('delta-plus').disabled = delta >= DELTA_MAX_MINUTES;
}

export function renderHomeActions(action) {
    renderHomeActionButtons(action);
    setText('draft-status', action.mode === 'apply' ? 'Modifications non appliquées. Le suivi continue sur les réglages précédents.' : STATE.session.active ? 'La localisation continue pendant les réglages.' : 'Horaires théoriques, décalage ΔT inclus.');
}

// Les coordonnées sont affichables dans les détails, pas annoncées par le
// lecteur d'écran à chaque seconde. Seuls les événements utiles sont notifiés.
export const updateInfo = message => showInfo(message, INFO_DISPLAY_MS);

let previousView = 'home';
export function renderNavigation() {
    const tracking = STATE.view === 'tracking';
    if (!STATE.session.active) {
        currentModel = null;
        currentProfile = null;
        renderedSession = null;
        currentRailLabel = '';
        profileView.reset();
        routeRevision = null;
        activeIndex = null;
        carouselView().reset();
        setProfileRange('trip');
    }
    el('home-view').hidden = tracking;
    el('tracking-view').hidden = !tracking;
    el('session-status').hidden = !STATE.session.active;
    document.body.classList.toggle('tracking-active', tracking);
    if (!tracking) carouselView().cancelScroll();
    if (STATE.view !== previousView) {
        (tracking ? el('tracking-view') : el('home-title')).focus({ preventScroll: true });
        previousView = STATE.view;
    }
}

const signalLabels = { waiting: 'En attente de localisation', lost: 'Signal perdu · dernière position conservée', recovering: 'Signal instable · récupération', 'off-route': 'Position hors du trajet', ok: 'Signal actif', idle: 'Localisation arrêtée' };
let currentModel;
let currentProfile;
let currentRailLabel = '';
let renderedSession = null;
let routeRevision = null;
let activeIndex = null;
const profileView = createSpeedProfileView({
    maxKmh: MAX_TRAIN_SPEED_KMH, maxColumns: PROFILE_MAX_COLUMNS, recentWindowMs: PROFILE_RECENT_WINDOW_MS,
    accent: '#8b2a3f', darkCursor: '#f0b9c4'
});
let carousel = null;
// Créé à la première utilisation : le module peut être chargé avant le DOM.
const carouselView = () => carousel ||= createCarouselView({
    carousel: el('train-carousel'), points: el('train-points'), recenterButton: el('recenter-btn'),
    heroRatio: CAROUSEL_HERO_RATIO, animationMs: CAROUSEL_ANIMATION_MS
});
let lastPassageKey = '';
let profileRange = 'trip';
const PROFILE_HELP = 'Survolez ou touchez le profil pour lire une mesure. Au clavier, utilisez les flèches.';

/** Étendue du profil détaillé : tout le voyage (axe en km) ou fenêtre récente (axe en temps). */
export function setProfileRange(range) {
    const next = range === 'recent' ? 'recent' : 'trip';
    document.querySelectorAll('[data-profile-range]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.profileRange === next));
    });
    document.querySelectorAll('[data-trip-legend]').forEach(node => { node.hidden = next === 'recent'; });
    if (next === profileRange) return;
    profileRange = next;
    el('profile-readout').hidden = true;
    setText('details-readout', PROFILE_HELP);
    if (!currentProfile || STATE.view !== 'tracking') return;
    drawSpeedProfile(el('speed-profile'), currentProfile, true);
    if (el('trip-details').open) drawSpeedProfile(el('details-profile'), currentProfile);
}

export const pauseCarouselFollow = () => carouselView().pause();
export const recenterCarousel = () => carouselView().recenter();

function layoutCarousel(animate = false) {
    if (!currentModel) return;
    const progress = STATE.trackingSnapshot?.progress;
    carouselView().layout({
        index: currentModel.progress.currentIdx,
        ratio: progress ? computeSegmentRatio(progress.distanceFromSegmentStart, progress.distanceToNextPointKm) : 0,
        located: !!STATE.trackingSnapshot
    }, animate);
}

// Libellés affichés (forme longue ou abrégée), décidés pour la géométrie
// courante du carrousel : recalculés à chaque changement de trajet ou de taille.
let pointLabels = new Map();
let pointLabelsKey = '';
const pointLabel = name => pointLabels.get(name) || name;

/**
 * Mesure chaque nom au format « prochain point », dans le carrousel lui-même
 * (mêmes unités de conteneur, mêmes marges), sur une ligne témoin invisible.
 * @returns {boolean} vrai si les libellés ont été recalculés
 */
function refreshPointLabels(container) {
    const carousel = container.parentElement;
    const key = `${STATE.planRevision}|${carousel.clientWidth}x${carousel.clientHeight}`;
    if (!carousel.clientWidth || key === pointLabelsKey) return false;
    const probe = document.createElement('article');
    probe.className = 'train-point next';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;top:0;left:0;right:0;visibility:hidden;pointer-events:none';
    const label = document.createElement('div');
    label.className = 'point-name';
    probe.appendChild(label);
    container.appendChild(probe);
    const style = getComputedStyle(label);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const fitsOnOneLine = text => {
        label.textContent = text;
        return label.getBoundingClientRect().height < lineHeight * 1.5;
    };
    pointLabels = buildPointLabels(STATE.currentRoute.map(point => point.name), fitsOnOneLine);
    probe.remove();
    pointLabelsKey = key;
    return true;
}

function renderCarousel(model, nowTs, relayout) {
    const container = el('train-points');
    const changed = routeRevision !== STATE.planRevision;
    const idxChanged = activeIndex !== model.progress.currentIdx;
    if (changed) {
        routeRevision = STATE.planRevision;
        lastPassageKey = '';
        el('profile-readout').hidden = true;
        setText('details-readout', PROFILE_HELP);
        container.innerHTML = STATE.currentRoute.map((point, index) => `<article class="train-point${point.isStop ? ' stop' : ''}" data-index="${index}"><i class="point-dot" aria-hidden="true"></i><div class="point-name">${escapeHtml(point.name)}</div><div class="point-meta"><span class="theory"></span><span class="point-result"></span></div><div class="point-detail"></div></article>`).join('') + '<i class="train-cursor" aria-hidden="true" hidden></i>';
    }
    if (refreshPointLabels(container) || changed) {
        STATE.currentRoute.forEach((point, index) => {
            const label = container.children[index]?.querySelector('.point-name');
            const text = pointLabel(point.name);
            if (!label || label.textContent === text) return;
            label.textContent = text;
            // Le nom complet reste lisible au survol et par les lecteurs d'écran.
            if (text !== point.name) label.title = point.name;
            else label.removeAttribute('title');
        });
    }
    const points = buildCarouselModel(STATE, model, nowTs);
    points.forEach(point => {
        const node = container.children[point.index];
        const active = point.index === model.progress.currentIdx;
        const next = point.index === model.progress.currentIdx + 1;
        const className = `train-point${point.isStop ? ' stop' : ''}${active ? ' active' : next ? ' next' : point.index < model.progress.currentIdx ? ' past' : ''}`;
        if (node.className !== className) node.className = className;
        if (active && STATE.trackingSnapshot) node.setAttribute('aria-current', 'step');
        else node.removeAttribute('aria-current');
        const theory = node.querySelector('.theory');
        const theoryText = clock(point.theoreticalTs);
        if (theory.textContent !== theoryText) {
            theory.textContent = theoryText;
            theory.title = `Horaire théorique : ${dateTime(point.theoreticalTs)}`;
        }
        const result = node.querySelector('.point-result');
        const { text, tone } = pointOutcome(point, next);
        if (result.textContent !== text) result.textContent = text;
        const resultClass = `point-result${tone ? ` ${tone}` : ''}`;
        if (result.className !== resultClass) result.className = resultClass;
        const detail = node.querySelector('.point-detail');
        const info = next && point.distanceKm != null ? `${kmText(point.distanceKm)} km${point.remainingSeconds != null ? ` · ${duration(point.remainingSeconds)}` : ''}${point.isStop ? ' · arrêt commercial' : ''}` : active && model.phase === 'arrived' ? 'Voyage arrivé' : point.isStop ? 'Arrêt commercial' : '';
        if (detail.textContent !== info) detail.textContent = info;
    });
    activeIndex = model.progress.currentIdx;
    // La géométrie peut changer avec les libellés, la taille du texte et la rotation.
    // Un tick ordinaire ne reprend jamais la main sur un défilement libre.
    layoutCarousel(!changed && idxChanged && !relayout);
}

/** Un seul modèle alimente tous les formats ; aucun abonnement GPS dans le rendu. */
export function renderTrainTracking({ relayout = false, nowTs = Date.now(), railLocation } = {}) {
    if (railLocation !== undefined) currentRailLabel = railLocation ? `PK ${formatPk(railLocation.pk)}${railLocation.line ? ` (${railLocation.line})` : ''}` : '';
    if (!STATE.session.active || STATE.view !== 'tracking') return;
    if (renderedSession !== STATE.session) {
        renderedSession = STATE.session;
        carouselView().reset();
    }
    const model = currentModel = buildCockpitModel(STATE, nowTs);
    if (!model) return;
    currentProfile = buildSpeedProfile(STATE);
    setText('tracking-route', MAIN_ROUTES[STATE.appliedConfig.mainRouteKey]?.label || 'Votre voyage');
    const speedReliable = model.speedReliable && model.location.signal === 'ok';
    setText('speed-value', speedReliable ? Math.round(model.speedKmh) : '—');
    el('speed-gauge').setAttribute('aria-label', speedReliable ? `${Math.round(model.speedKmh)} kilomètres par heure` : 'Vitesse indisponible');
    el('gauge-value').style.strokeDasharray = `${speedReliable ? Math.min(1, model.speedKmh / MAX_TRAIN_SPEED_KMH) * 222 : 0} 333`;
    const hasEstimate = !!STATE.trackingSnapshot;
    setText('arrival-label', model.phase === 'arrived' ? 'Arrivée observée' : hasEstimate ? 'Arrivée prévue' : 'Arrivée théorique');
    const arrivalTs = model.phase === 'arrived' ? STATE.passageTimes[STATE.currentRoute.at(-1).id] : hasEstimate ? model.arrival.estimatedTs : model.arrival.theoreticalTs;
    setText('arrival-time', clock(arrivalTs));
    const departureDate = new Date(model.departure.theoreticalTs).toDateString();
    setText('arrival-date', new Date(arrivalTs).toDateString() !== departureDate ? new Date(arrivalTs).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
    const uncertain = model.phase !== 'arrived' && (!hasEstimate || model.location.signal !== 'ok');
    setText('delay-chip', uncertain ? hasEstimate ? 'Dernière estimation' : 'En attente' : model.phase === 'before-departure' ? 'Avant départ' : model.displayDelayMs ? `${model.displayDelayMs > 0 ? '+' : '−'}${Math.abs(model.displayDelayMs) / 60000} min` : 'À l’heure');
    el('delay-chip').className = `delay-chip ${uncertain ? '' : model.displayDelayMs > 0 ? 'late' : model.displayDelayMs < 0 ? 'early' : 'ok'}`;
    setText('arrival-theory', `Horaire théorique ${clock(model.arrival.theoreticalTs)}`);
    const next = model.nextStop;
    setText('next-stop-name', next?.name || 'Arrivée atteinte');
    setText('next-stop-time', next ? `${hasEstimate ? '≈ ' : ''}${clock(next.estimatedTs)}` : '');
    setText('next-stop-info', next ? `${next.distanceKm != null ? `${kmText(next.distanceKm)} km · ` : ''}${hasEstimate ? `${duration(next.remainingSeconds)} · ` : ''}théo. ${clock(next.theoreticalTs)}` : 'Les passages restent consultables dans les détails.');
    setText('km-done', kmText(model.progress.doneKm));
    setText('km-left', kmText(model.progress.leftKm));
    setText('speed-average', hasEstimate ? Math.round(model.stats.avgKmh) : '—');
    setText('speed-max', hasEstimate ? Math.round(model.stats.maxKmh) : '—');
    // Repli GPS d'une configuration WiFi SNCF : la source affichée le dit.
    const source = model.location.source === 'sncf' ? window.IS_SCRIPTABLE_BRIDGE ? 'Bridge SNCF' : 'WiFi SNCF'
        : STATE.appliedConfig?.locationMethod === 'sncf' ? 'GPS (repli WiFi SNCF)' : 'GPS';
    const ageS = model.location.ageMs != null ? Math.floor(model.location.ageMs / 1000) : 0;
    const locationText = `${source} · ${signalLabels[model.location.signal]}${ageS >= 3 ? ` · il y a ${ageS} s` : ''}${model.location.accuracyM != null ? ` · ±${Math.round(model.location.accuracyM)} m` : ''}`;
    setText('location-status', locationText);
    el('location-status').dataset.signal = model.location.signal;
    el('journey-progress').setAttribute('aria-valuenow', Math.round(model.progress.ratio * 100));
    el('journey-progress').firstElementChild.style.width = `${model.progress.ratio * 100}%`;
    setText('progress-label', model.progress.doneKm == null ? 'Position en attente' : `${kmText(model.progress.doneKm)} / ${kmText(model.progress.totalKm)} km · ${Math.round(model.progress.ratio * 100)} %`);
    renderCarousel(model, nowTs, relayout);
    drawSpeedProfile(el('speed-profile'), currentProfile, true);
    if (el('trip-details').open) renderTripDetails();
}

function drawSpeedProfile(canvas, profile, dark = false) {
    const drawn = profileView.draw(canvas, profile, { dark, range: profileRange });
    if (!drawn) return;
    canvas.setAttribute('aria-label', drawn.recent
        ? `Vitesse des ${PROFILE_RECENT_WINDOW_MS / 60_000} dernières minutes, axe en temps. ${drawn.points} mesures. Mesures pleines, moyennes horaires théoriques en pointillés.`
        : `Vitesse sur ${kmText(profile.totalKm)} kilomètres. Maximum mesuré ${Math.round(profile.maxKmh)} km/h. ${profile.passages.length} passages observés. Mesures pleines, moyennes horaires théoriques en pointillés. Détails dans le journal des passages.`);
}

export function renderTripDetails() {
    if (!currentModel || !currentProfile) return;
    drawSpeedProfile(el('details-profile'), currentProfile);
    let lastFix = null;
    for (let i = STATE.session.samples.length - 1; i >= 0 && !lastFix; i--) {
        if (Number.isFinite(STATE.session.samples[i].lat)) lastFix = STATE.session.samples[i];
    }
    setText('details-location', `${el('location-status').textContent}${lastFix ? ` · ${lastFix.lat.toFixed(5)}, ${lastFix.lon.toFixed(5)}` : ''}${currentRailLabel ? ` · ${currentRailLabel}` : ''}`);
    const key = `${STATE.planRevision}|${currentProfile.passages.length}`;
    if (key === lastPassageKey) return;
    lastPassageKey = key;
    el('passage-log').innerHTML = currentProfile.passages.length ? currentProfile.passages.map(passage => `<tr><th scope="row">${escapeHtml(pointLabel(passage.name))}${passage.isStop ? ' · arrêt' : ''}</th><td>${dateTime(passage.theoreticalTs)}</td><td>${dateTime(passage.ts)}</td><td>${delayText(passage.delayMs)}</td></tr>`).join('') : '<tr><td colspan="4">Aucun passage observé pour le moment.</td></tr>';
}

export function inspectSpeedProfile(canvas, event) {
    profileView.inspect(canvas, event, el(canvas.id === 'details-profile' ? 'details-readout' : 'profile-readout'));
}
