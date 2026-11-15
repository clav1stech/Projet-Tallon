import { STATE } from './state.js';
import { MAIN_ROUTES } from './routes-config.js';
import { buildCockpitModel, buildCarouselModel, buildSpeedProfile } from './tracking-session.js';
import { computeSegmentRatio } from './functions.js';
import { buildProfileEnvelope, buildRecentWindow } from './train-profile.js';
import { formatTime } from './utils.js';
import { formatPk } from './linearref.js';
import { CAROUSEL_ANIMATION_MS, CAROUSEL_HERO_RATIO, DELTA_MAX_MINUTES, DELTA_MIN_MINUTES, INFO_DISPLAY_MS, MAX_TRAIN_SPEED_KMH, PROFILE_MAX_COLUMNS, PROFILE_RECENT_WINDOW_MS } from './train-config.js';

const el = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setText = (id, text) => { const node = el(id); if (node && node.textContent !== String(text)) node.textContent = text; };
const clock = ts => Number.isFinite(ts) ? formatTime(new Date(ts)) : '––:––';
const kmText = km => Number.isFinite(km) ? km.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—';
const duration = seconds => {
    const minutes = Math.max(0, Math.round(seconds / 60));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
};
const dateTime = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const delayText = ms => {
    const seconds = Math.round(Math.abs(ms) / 1000);
    return `${ms < 0 ? '−' : '+'}${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
};

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
    setText('start-btn', { launch: 'Lancer le suivi →', apply: 'Appliquer et reprendre →', resume: 'Reprendre le suivi →' }[action.mode]);
    el('start-btn').disabled = !action.enabled;
    el('start-btn').dataset.mode = action.mode;
    el('secondary-btn').hidden = !action.secondary;
    setText('secondary-btn', { cancel: 'Annuler les modifications', end: 'Terminer' }[action.secondary] || '');
    setText('draft-status', action.mode === 'apply' ? 'Modifications non appliquées. Le suivi continue sur les réglages précédents.' : STATE.session.active ? 'La localisation continue pendant les réglages.' : 'Horaires théoriques, décalage ΔT inclus.');
}

let infoTimer;
let lastInfo = '';
export function updateInfo(message) {
    // Les coordonnées sont affichables dans les détails, pas annoncées par le
    // lecteur d'écran à chaque seconde. Seuls les événements utiles sont notifiés.
    if (message === lastInfo) return;
    lastInfo = message;
    const node = el('info');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => { node.hidden = true; }, INFO_DISPLAY_MS);
}

let previousView = 'home';
export function renderNavigation() {
    const tracking = STATE.view === 'tracking';
    if (!STATE.session.active) {
        currentModel = null;
        currentProfile = null;
        renderedSession = null;
        currentRailLabel = '';
        profileLayouts = new WeakMap();
        routeRevision = null;
        activeIndex = null;
        following = true;
        el('recenter-btn').hidden = true;
        setProfileRange('trip');
    }
    el('home-view').hidden = tracking;
    el('tracking-view').hidden = !tracking;
    el('session-status').hidden = !STATE.session.active;
    document.body.classList.toggle('tracking-active', tracking);
    if (!tracking && scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = null; }
    if (STATE.view !== previousView) {
        (tracking ? el('tracking-view') : el('home-title')).focus({ preventScroll: true });
        previousView = STATE.view;
    }
}

const signalLabels = { waiting: 'En attente de localisation', lost: 'Signal perdu · dernière position conservée', recovering: 'Signal instable · récupération', 'off-route': 'Position hors du trajet', ok: 'Signal actif', idle: 'Localisation arrêtée' };
let currentModel;
let currentProfile;
let currentRailLabel = '';
let profileLayouts = new WeakMap();
let renderedSession = null;
let routeRevision = null;
let activeIndex = null;
let following = true;
let scrollFrame = null;
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

export function pauseCarouselFollow() {
    following = false;
    el('recenter-btn').hidden = false;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
}

export function recenterCarousel() {
    following = true;
    el('recenter-btn').hidden = true;
    layoutCarousel(true);
}

function layoutCarousel(animate = false) {
    const points = el('train-points');
    const carousel = el('train-carousel');
    if (!currentModel || !carousel.clientHeight) return;
    const first = points.querySelector('.train-point');
    if (!first) return;
    const y = node => node.offsetTop + node.offsetHeight / 2;
    const all = points.querySelectorAll('.train-point');
    const lastPoint = all[all.length - 1];
    points.style.setProperty('--line-top', `${y(first)}px`);
    points.style.setProperty('--line-height', `${y(lastPoint) - y(first)}px`);
    const from = all[currentModel.progress.currentIdx];
    const to = all[currentModel.progress.currentIdx + 1];
    const progress = STATE.trackingSnapshot?.progress;
    const ratio = progress ? computeSegmentRatio(progress.distanceFromSegmentStart, progress.distanceToNextPointKm) : 0;
    points.style.setProperty('--cursor-top', `${from ? y(from) + (to ? (y(to) - y(from)) * ratio : 0) : y(first)}px`);
    points.querySelector('.train-cursor').hidden = !STATE.trackingSnapshot;
    if (!following) return;
    const target = to || from || first;
    const top = Math.max(0, y(target) - carousel.clientHeight * CAROUSEL_HERO_RATIO);
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reducedMotion) { carousel.scrollTop = top; scrollFrame = null; return; }
    const start = carousel.scrollTop;
    const startTime = performance.now();
    const step = now => {
        const t = Math.min(1, (now - startTime) / CAROUSEL_ANIMATION_MS);
        carousel.scrollTop = start + (top - start) * (1 - (1 - t) ** 3);
        scrollFrame = t < 1 ? requestAnimationFrame(step) : null;
    };
    scrollFrame = requestAnimationFrame(step);
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
        let text = '';
        if (point.observedTs != null) text = `Observé ${clock(point.observedTs)} · ${delayText(point.delayMs)}`;
        else if (point.estimatedTs != null) text = `Prévu ≈ ${clock(point.estimatedTs)}`;
        else if (point.index < model.progress.currentIdx) text = 'Passage non observé';
        else text = 'Théorique';
        if (result.textContent !== text) result.textContent = text;
        const resultClass = `point-result${point.observedTs != null ? point.delayMs > 0 ? ' late' : ' observed' : ''}`;
        if (result.className !== resultClass) result.className = resultClass;
        const detail = node.querySelector('.point-detail');
        const info = next && point.distanceKm != null ? `${kmText(point.distanceKm)} km${point.remainingSeconds != null ? ` · ${duration(point.remainingSeconds)}` : ''}${point.isStop ? ' · arrêt commercial' : ''}` : active && STATE.trackingSnapshot ? model.phase === 'arrived' ? 'Voyage arrivé' : 'Dernier repère · position sur le segment' : point.isStop ? 'Arrêt commercial' : '';
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
        following = true;
        el('recenter-btn').hidden = true;
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

/** Le canvas est dimensionné en pixels physiques après chaque changement de surface. */
function drawSpeedProfile(canvas, profile, dark = false) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width, height = rect.height;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const detailed = height >= 90;
    const recent = detailed && profileRange === 'recent';
    const left = detailed ? 30 : 1, right = 12, bottom = detailed ? 23 : 3, top = 8;
    const w = Math.max(1, width - left - right), h = Math.max(1, height - top - bottom);
    // L'échelle est celle des vitesses mesurables : une moyenne horaire
    // aberrante sur un segment court est écrêtée, elle n'écrase pas la courbe.
    const max = MAX_TRAIN_SPEED_KMH;
    const y = v => top + h - Math.min(max, Math.max(0, v)) / max * h;
    const colors = dark
        ? { grid: '#ffffff20', text: '#c8c1c3', planned: '#c8c1c3', measured: '#fff', cursor: '#f0b9c4', stop: '#ffffff30', late: '#ff8a73', onTime: '#6fd9a8' }
        : { grid: '#211d1e20', text: '#71676a', planned: '#8a777e', measured: '#8b2a3f', cursor: '#8b2a3f', stop: '#211d1e20', late: '#b8371f', onTime: '#1f7a52' };
    ctx.font = '11px system-ui';ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;ctx.fillStyle = colors.text;
    if (detailed) {
        for (const v of [0, max / 2, max]) {
            ctx.beginPath();ctx.moveTo(left, y(v));ctx.lineTo(width - right, y(v));ctx.stroke();ctx.fillText(String(Math.round(v)), 0, y(v) + 4);
        }
    }
    if (recent) {
        const recentWindow = buildRecentWindow(profile, PROFILE_RECENT_WINDOW_MS);
        const { fromTs, toTs, points } = recentWindow;
        const x = ts => left + (ts - fromTs) / PROFILE_RECENT_WINDOW_MS * w;
        const minutes = PROFILE_RECENT_WINDOW_MS / 60_000;
        ctx.fillText(`−${minutes} min`, left, height - 4);
        ctx.textAlign = 'right';ctx.fillText(toTs == null ? 'Aucune mesure' : `Dernière mesure ${clock(toTs)}`, width - right, height - 4);ctx.textAlign = 'left';
        ctx.strokeStyle = colors.planned;ctx.setLineDash([4, 4]);ctx.beginPath();
        let previous = null;
        for (const point of points) {
            if (point.plannedKmh == null) { previous = null; continue; }
            if (!previous || point.gap) ctx.moveTo(x(point.ts), y(point.plannedKmh));
            else { ctx.lineTo(x(point.ts), y(previous.plannedKmh));ctx.lineTo(x(point.ts), y(point.plannedKmh)); }
            previous = point;
        }
        ctx.stroke();ctx.setLineDash([]);
        ctx.strokeStyle = colors.measured;ctx.lineWidth = 1.7;ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0 || point.gap) ctx.moveTo(x(point.ts), y(point.v));
            else ctx.lineTo(x(point.ts), y(point.v));
        });
        ctx.stroke();
        profileLayouts.set(canvas, { recent: true, points, fromTs, toTs, left, width: w });
        canvas.setAttribute('aria-label', `Vitesse des ${minutes} dernières minutes, axe en temps. ${points.length} mesures. Mesures pleines, moyennes horaires théoriques en pointillés.`);
        return;
    }
    const x = km => left + km / (profile.totalKm || 1) * w;
    if (detailed) {
        ctx.fillText('0', left, height - 4);ctx.textAlign = 'right';ctx.fillText(`${kmText(profile.totalKm)} km`, width - right, height - 4);ctx.textAlign = 'left';
    }
    ctx.strokeStyle = colors.planned;ctx.setLineDash([4, 4]);ctx.beginPath();
    for (const segment of profile.planned) { ctx.moveTo(x(segment.fromKm), y(segment.kmh));ctx.lineTo(x(segment.toKm), y(segment.kmh)); }
    ctx.stroke();ctx.setLineDash([]);
    const envelope = buildProfileEnvelope(profile, Math.min(PROFILE_MAX_COLUMNS, w));
    profileLayouts.set(canvas, { envelope, totalKm: profile.totalKm, left, width: w });
    ctx.strokeStyle = colors.measured;ctx.lineWidth = 1.7;ctx.beginPath();
    let previous = null;
    for (const bucket of envelope) {
        const points = [bucket.first, bucket.min, bucket.max, bucket.last].sort((a, b) => a.ts - b.ts);
        if (!previous || bucket.gap || previous.gap) ctx.moveTo(x(points[0].routeKm), y(points[0].v));
        else ctx.lineTo(x(points[0].routeKm), y(points[0].v));
        for (const point of points) ctx.lineTo(x(point.routeKm), y(point.v));
        previous = bucket;
    }
    ctx.stroke();
    if (profile.currentKm != null) {
        ctx.strokeStyle = colors.cursor;ctx.lineWidth = 1;ctx.beginPath();ctx.moveTo(x(profile.currentKm), top);ctx.lineTo(x(profile.currentKm), top + h);ctx.stroke();
    }
    if (detailed) {
        for (const stop of profile.stops) {
            ctx.strokeStyle = colors.stop;ctx.beginPath();ctx.moveTo(x(stop.km), top);ctx.lineTo(x(stop.km), top + h);ctx.stroke();
        }
        for (const passage of profile.passages) {
            ctx.fillStyle = passage.delayMs > 0 ? colors.late : colors.onTime;ctx.beginPath();ctx.arc(x(passage.km), top + h, 3, 0, Math.PI * 2);ctx.fill();
        }
    }
    canvas.setAttribute('aria-label', `Vitesse sur ${kmText(profile.totalKm)} kilomètres. Maximum mesuré ${Math.round(profile.maxKmh)} km/h. ${profile.passages.length} passages observés. Mesures pleines, moyennes horaires théoriques en pointillés. Détails dans le journal des passages.`);
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
    el('passage-log').innerHTML = currentProfile.passages.length ? currentProfile.passages.map(passage => `<tr><th scope="row">${escapeHtml(passage.name)}${passage.isStop ? ' · arrêt' : ''}</th><td>${dateTime(passage.theoreticalTs)}</td><td>${dateTime(passage.ts)}</td><td>${delayText(passage.delayMs)}</td></tr>`).join('') : '<tr><td colspan="4">Aucun passage observé pour le moment.</td></tr>';
}

/** Inspection au doigt, à la souris et au clavier, depuis les mesures du tracé. */
export function inspectSpeedProfile(canvas, event) {
    const layout = profileLayouts.get(canvas);
    const items = layout?.recent ? layout.points : layout?.envelope;
    if (!items || !items.length) return;
    const rect = canvas.getBoundingClientRect();
    const readout = el(canvas.id === 'details-profile' ? 'details-readout' : 'profile-readout');
    let index = null;
    let ratio = 0;
    if (event.type === 'keydown') {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        index = Math.max(0, Math.min(items.length - 1,
            event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Number(canvas.dataset.readIndex || 0) + (event.key === 'ArrowRight' ? 1 : -1)));
        canvas.dataset.readIndex = index;
    } else {
        ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - layout.left) / layout.width));
    }
    let sample = null;
    if (layout.recent) {
        if (index != null) sample = items[index];
        else {
            const targetTs = layout.fromTs + ratio * (layout.toTs - layout.fromTs);
            for (const point of items) {
                if (!sample || Math.abs(point.ts - targetTs) < Math.abs(sample.ts - targetTs)) sample = point;
            }
        }
        readout.hidden = false;
        readout.textContent = `${dateTime(sample.ts)} · ${Math.round(sample.v)} km/h mesurés${sample.plannedKmh != null ? ` · moyenne théorique ${Math.round(sample.plannedKmh)} km/h` : ''}`;
        return;
    }
    const targetKm = index != null ? items[index].last.routeKm : ratio * layout.totalKm;
    for (const bucket of items) {
        for (const point of [bucket.first, bucket.min, bucket.max, bucket.last]) {
            if (!sample || Math.abs(point.routeKm - targetKm) < Math.abs(sample.routeKm - targetKm)) sample = point;
        }
    }
    readout.hidden = false;
    readout.textContent = `${kmText(sample.routeKm)} km · ${Math.round(sample.v)} km/h mesurés · ${dateTime(sample.ts)}`;
}
