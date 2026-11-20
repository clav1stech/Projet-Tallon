// js/route-profile-page.js
// Profil de vitesse théorique d'un trajet, aller et retour superposés sur le
// même axe kilométrique : une durée rangée sur le mauvais segment y apparaît
// comme un pic d'un côté et un creux de l'autre. Lecture seule ; la correction
// se fait dans l'éditeur de trajets, ouvert directement sur le segment.

import { MAIN_ROUTES } from './routes-config.js';
import { downloadMasterRoutesDocument, buildMasterRoutesDocument } from './master-routes-data.js';
import { clearMasterRoutesDraft, loadEditableMasterRoutes } from './master-routes-draft.js';
import { buildRouteSegments, formatDuration, summarizeRouteSegments } from './route-speed.js';
import { ROUTE_SPEED_BOUNDS_KMH } from './train-config.js';
import { mountEditorShell, readQueryParam, setStatus } from './editor-shell.js';

// Haut de l'échelle : au-dessus, une vitesse est écrêtée et signalée par ▲,
// pour qu'un segment à 3 000 km/h n'écrase pas tout le reste du profil.
const CHART_MAX_KMH = 360;
const CHART_MARGIN = { top: 30, right: 14, bottom: 30, left: 46 };
const STATION_LABEL_GAP_PX = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

const STATUS_LABELS = {
    ok: { label: 'Plausible', icon: 'fa-check' },
    'too-fast': { label: 'Trop rapide', icon: 'fa-exclamation-triangle' },
    'too-slow': { label: 'Trop lent', icon: 'fa-hourglass-half' },
    'no-duration': { label: 'Durée manquante', icon: 'fa-question-circle' }
};

const routeSelect = document.getElementById('profile-route');
const compareToggle = document.getElementById('profile-compare');
const editLink = document.getElementById('profile-edit');
const statsEl = document.getElementById('profile-stats');
const legendEl = document.getElementById('profile-legend');
const chartEl = document.getElementById('profile-chart');
const tooltipEl = document.getElementById('profile-tooltip');
const statusEl = document.getElementById('profile-status');
const tableDirectionEl = document.getElementById('profile-table-direction');
const rowsEl = document.getElementById('profile-rows');

const shell = mountEditorShell({ active: 'profile' });

const state = {
    data: null,
    fileData: null,
    storage: null,
    routeKey: '',
    series: [],
    tableSeries: 0,
    selected: null
};

const km = value => value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kmh = value => (Number.isFinite(value) ? `${Math.round(value).toLocaleString('fr-FR')} km/h` : '—');

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function svg(tag, attributes = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
}

function statusPill(status) {
    const meta = STATUS_LABELS[status];
    const pill = element('span', `status-pill ${status}`);
    const glyph = element('i', `fas ${meta.icon}`);
    glyph.setAttribute('aria-hidden', 'true');
    pill.append(glyph, element('span', '', meta.label));
    return pill;
}

function reverseRouteKey(routeKey) {
    const config = MAIN_ROUTES[routeKey];
    return Object.keys(MAIN_ROUTES).find(key => MAIN_ROUTES[key].startPointId === config.endPointId
        && MAIN_ROUTES[key].endPointId === config.startPointId) || null;
}

/**
 * Série affichable : segments du trajet et position de chacun sur l'axe du
 * trajet sélectionné. Le retour est reporté en miroir (km total − km parcouru).
 */
function buildSeries(routeKey, mirrored) {
    const config = MAIN_ROUTES[routeKey];
    const route = state.data.trajets.find(item => item.id === config.masterRouteId);
    if (!route) return null;
    const segments = buildRouteSegments(state.data.points, route);
    const summary = summarizeRouteSegments(segments);
    const placed = segments.map(segment => ({
        ...segment,
        axisStart: mirrored ? summary.totalKm - segment.endKm : segment.startKm,
        axisEnd: mirrored ? summary.totalKm - segment.startKm : segment.endKm
    }));
    return {
        routeKey,
        label: config.label,
        route,
        voie: route.voie === 2 ? 2 : 1,
        segments: placed,
        summary
    };
}

function rebuildSeries() {
    const reverseKey = reverseRouteKey(state.routeKey);
    compareToggle.disabled = !reverseKey;
    const series = [buildSeries(state.routeKey, false)];
    if (reverseKey && compareToggle.checked) series.push(buildSeries(reverseKey, true));
    state.series = series.filter(Boolean);
    state.tableSeries = Math.min(state.tableSeries, state.series.length - 1);
    state.selected = null;
}

// ---------- Synthèse ----------

function renderStats() {
    const tiles = state.series.map(series => {
        const tile = element('div', 'stat');
        const label = element('span', 'stat-label');
        label.append(element('i', `dir-swatch dir-${series.voie}`), ` ${series.label}`);
        const count = series.summary.anomalies.length;
        tile.append(
            label,
            element('span', 'stat-value', formatDuration(series.summary.totalS)),
            element('span', 'stat-sub', `${km(series.summary.totalKm)} km · moyenne ${kmh(series.summary.averageKmh)}`),
            element('span', 'stat-sub', count ? `⚠ ${count} segment${count > 1 ? 's' : ''} hors plage` : '✓ aucun segment hors plage')
        );
        if (count) tile.classList.add('has-issue');
        return tile;
    });
    if (state.series.length === 2) {
        const [aller, retour] = state.series;
        const delta = retour.summary.totalS - aller.summary.totalS;
        const tile = element('div', 'stat');
        tile.append(
            element('span', 'stat-label', 'Écart retour − aller'),
            element('span', 'stat-value', `${delta < 0 ? '−' : '+'}${formatDuration(Math.abs(delta))}`),
            element('span', 'stat-sub', 'sur les durées de base, hors arrêts')
        );
        tiles.push(tile);
    }
    statsEl.replaceChildren(...tiles);

    legendEl.replaceChildren(...state.series.map(series => {
        const item = element('span');
        item.append(element('i', `dir-swatch dir-${series.voie}`), series.label);
        return item;
    }), (() => {
        const item = element('span');
        item.append(element('i', 'dir-swatch tunnel'), `plage plausible ${ROUTE_SPEED_BOUNDS_KMH.min}–${ROUTE_SPEED_BOUNDS_KMH.max} km/h`);
        return item;
    })());
}

// ---------- Graphique ----------

function niceStep(totalKm, widthPx) {
    const target = totalKm / Math.max(2, Math.floor(widthPx / 80));
    return [5, 10, 20, 25, 50, 100, 200].find(step => step >= target) || 200;
}

function renderChart() {
    for (const node of [...chartEl.querySelectorAll('svg')]) node.remove();
    const primary = state.series[0];
    if (!primary) return;
    const width = chartEl.clientWidth;
    const height = chartEl.clientHeight;
    if (!width || !height) return;

    const { top, right, bottom, left } = CHART_MARGIN;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const totalKm = Math.max(...state.series.map(series => series.summary.totalKm));
    const x = value => left + value / totalKm * plotW;
    const y = value => top + plotH - Math.min(value, CHART_MAX_KMH) / CHART_MAX_KMH * plotH;

    const root = svg('svg', {
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': `Profil de vitesse moyenne de ${state.series.map(series => series.label).join(' et ')}, `
            + `${primary.summary.anomalies.length} segment(s) hors plage à l’aller. Le tableau ci-dessous détaille chaque segment.`
    });

    const bands = svg('g');
    for (const series of state.series) {
        for (const segment of series.segments.filter(item => item.status !== 'ok')) {
            bands.appendChild(svg('rect', {
                class: `chart-anomaly ${segment.status}`,
                x: x(segment.axisStart), y: top,
                width: Math.max(2, x(segment.axisEnd) - x(segment.axisStart)), height: plotH
            }));
        }
    }
    const selection = svg('rect', { class: 'chart-selected', y: top, height: plotH, width: 0, x: 0 });
    bands.appendChild(selection);
    root.appendChild(bands);

    const grid = svg('g', { class: 'chart-grid' });
    for (let value = 0; value <= CHART_MAX_KMH; value += 60) {
        grid.appendChild(svg('line', { x1: left, x2: width - right, y1: y(value), y2: y(value) }));
        root.appendChild(svg('text', { class: 'chart-tick', x: left - 8, y: y(value) + 4, 'text-anchor': 'end' }, String(value)));
    }
    root.insertBefore(grid, bands.nextSibling);
    root.appendChild(svg('text', { class: 'chart-tick', x: 0, y: top - 14 }, 'km/h'));

    for (const [value, label] of [[ROUTE_SPEED_BOUNDS_KMH.max, `plafond ${ROUTE_SPEED_BOUNDS_KMH.max}`], [ROUTE_SPEED_BOUNDS_KMH.min, `plancher ${ROUTE_SPEED_BOUNDS_KMH.min}`]]) {
        root.appendChild(svg('line', { class: 'chart-bound', x1: left, x2: width - right, y1: y(value), y2: y(value) }));
        root.appendChild(svg('text', { class: 'chart-bound-label', x: width - right, y: y(value) - 5, 'text-anchor': 'end' }, label));
    }

    const axis = svg('g', { class: 'chart-axis' });
    axis.appendChild(svg('line', { x1: left, x2: width - right, y1: top + plotH, y2: top + plotH }));
    const step = niceStep(totalKm, plotW);
    // La dernière graduation cède la place à l'unité quand elles se touchent.
    for (let value = 0; value <= totalKm && x(value) < width - right - 28; value += step) {
        axis.appendChild(svg('text', { class: 'chart-tick', x: x(value), y: height - 10, 'text-anchor': 'middle' }, `${value}`));
    }
    axis.appendChild(svg('text', { class: 'chart-tick', x: width - right, y: height - 10, 'text-anchor': 'end' }, 'km'));
    root.appendChild(axis);

    // Gares du trajet sélectionné : repères verticaux, libellés sans chevauchement.
    const stations = svg('g', { class: 'chart-station' });
    const stops = [{ name: primary.segments[0].fromName, at: 0 }];
    for (const segment of primary.segments) {
        if (segment.toType === 'gare' || segment === primary.segments.at(-1)) stops.push({ name: segment.toName, at: segment.endKm });
    }
    for (const stop of stops) {
        const px = x(stop.at);
        stations.appendChild(svg('line', { x1: px, x2: px, y1: top - 4, y2: top + plotH }));
    }
    root.appendChild(stations);
    chartEl.insertBefore(root, tooltipEl);
    // Libellés posés par priorité (départ, terminus, puis gares dans l'ordre),
    // mesurés une fois rendus : un libellé qui en chevaucherait un autre est omis.
    const placed = [];
    const order = [0, stops.length - 1, ...stops.keys()].filter((value, i, list) => list.indexOf(value) === i);
    for (const index of order) {
        const px = x(stops[index].at);
        const anchor = index === 0 ? 'start' : index === stops.length - 1 ? 'end' : 'middle';
        // « Le Creusot – Montceau – Montchanin TGV » → « Le Creusot » ; nom complet au survol.
        const label = svg('text', { x: px, y: top - 10, 'text-anchor': anchor }, stops[index].name.split(' – ')[0]);
        label.appendChild(svg('title', {}, stops[index].name));
        stations.appendChild(label);
        const box = label.getBBox();
        const span = [box.x - STATION_LABEL_GAP_PX, box.x + box.width + STATION_LABEL_GAP_PX];
        const outside = box.x < 0 || box.x + box.width > width;
        if (outside || placed.some(([from, to]) => span[0] < to && span[1] > from)) label.remove();
        else placed.push(span);
    }

    for (const series of state.series) {
        let d = '';
        let previous = null;
        for (const segment of [...series.segments].sort((a, b) => a.axisStart - b.axisStart)) {
            if (!Number.isFinite(segment.speedKmh)) { previous = null; continue; }
            const py = y(segment.speedKmh);
            d += previous === null ? `M${x(segment.axisStart)},${py}` : `V${py}`;
            d += `H${x(segment.axisEnd)}`;
            previous = py;
            if (segment.speedKmh > CHART_MAX_KMH) {
                root.appendChild(svg('text', {
                    class: `chart-clip-marker dir-${series.voie}`,
                    x: (x(segment.axisStart) + x(segment.axisEnd)) / 2,
                    y: top + (series === primary ? 11 : 23),
                    'text-anchor': 'middle'
                }, `▲ ${Math.round(segment.speedKmh)}`));
            }
        }
        root.appendChild(svg('path', { class: `chart-line dir-${series.voie}`, d }));
    }

    const crosshair = svg('line', { class: 'chart-crosshair', y1: top, y2: top + plotH, visibility: 'hidden' });
    const dots = state.series.map(series => svg('circle', { class: `chart-dot dir-${series.voie}`, r: 5, visibility: 'hidden' }));
    root.append(crosshair, ...dots);

    const overlay = svg('rect', { x: left, y: top, width: plotW, height: plotH, fill: 'transparent' });
    overlay.style.cursor = 'crosshair';
    root.appendChild(overlay);

    const hits = value => state.series.map(series =>
        series.segments.find(segment => value >= segment.axisStart && value <= segment.axisEnd) || null);

    const showAt = clientX => {
        const box = root.getBoundingClientRect();
        const px = Math.min(Math.max(clientX - box.left, left), left + plotW);
        const value = (px - left) / plotW * totalKm;
        const found = hits(value);
        crosshair.setAttribute('x1', px);
        crosshair.setAttribute('x2', px);
        crosshair.setAttribute('visibility', 'visible');
        found.forEach((segment, index) => {
            const visible = segment && Number.isFinite(segment.speedKmh);
            dots[index].setAttribute('visibility', visible ? 'visible' : 'hidden');
            if (visible) { dots[index].setAttribute('cx', px); dots[index].setAttribute('cy', y(segment.speedKmh)); }
        });
        renderTooltip(value, found);
        const tipW = tooltipEl.offsetWidth;
        const tipX = px + 14 + tipW > width ? px - 14 - tipW : px + 14;
        tooltipEl.style.left = `${Math.max(0, tipX)}px`;
        tooltipEl.style.top = `${top + 6}px`;
        return found;
    };
    const hide = () => {
        crosshair.setAttribute('visibility', 'hidden');
        dots.forEach(dot => dot.setAttribute('visibility', 'hidden'));
        tooltipEl.hidden = true;
    };
    overlay.addEventListener('pointermove', event => showAt(event.clientX));
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('click', event => {
        const found = showAt(event.clientX);
        const index = found[state.tableSeries] ? state.tableSeries : found.findIndex(Boolean);
        if (index >= 0) selectSegment(index, found[index].index, true);
    });

    state.drawSelection = () => {
        const selected = state.selected && state.series[state.selected.series]?.segments[state.selected.segment];
        selection.setAttribute('width', selected ? Math.max(2, x(selected.axisEnd) - x(selected.axisStart)) : 0);
        if (selected) selection.setAttribute('x', x(selected.axisStart));
    };
    state.drawSelection();
}

function renderTooltip(value, found) {
    tooltipEl.replaceChildren(element('span', 'chart-tooltip-km', `km ${km(value)} depuis ${state.series[0].segments[0].fromName}`));
    found.forEach((segment, index) => {
        if (!segment) return;
        const series = state.series[index];
        const row = element('div', 'tooltip-row');
        const text = element('div');
        const head = element('div');
        head.append(element('strong', '', kmh(segment.speedKmh)), ` · ${segment.fromName} → ${segment.toName}`);
        const detail = element('span', '', `${formatDuration(segment.durationS)} pour ${km(segment.distanceKm)} km`
            + `${segment.status !== 'ok' ? ` · ${STATUS_LABELS[segment.status].label}` : ''}`);
        text.append(head, detail);
        row.append(element('i', `dir-swatch dir-${series.voie}`), text);
        tooltipEl.appendChild(row);
    });
    tooltipEl.hidden = false;
}

// ---------- Tableau ----------

function renderTableDirection() {
    tableDirectionEl.replaceChildren(...state.series.map((series, index) => {
        const button = element('button', '', series.label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(index === state.tableSeries));
        button.addEventListener('click', () => {
            state.tableSeries = index;
            state.selected = null;
            renderTableDirection();
            renderRows();
            state.drawSelection?.();
        });
        return button;
    }));
    tableDirectionEl.hidden = state.series.length < 2;
}

function renderRows() {
    const series = state.series[state.tableSeries];
    rowsEl.replaceChildren();
    if (!series) return;
    for (const segment of series.segments) {
        const row = element('tr', segment.status);
        row.dataset.segment = String(segment.index);
        const name = element('td', 'seg-name');
        name.append(`${segment.fromName} → ${segment.toName}`, element('small', '', `${segment.fromId} → ${segment.toId}`));
        const status = element('td');
        status.appendChild(statusPill(segment.status));
        const fix = element('td', 'num');
        const link = element('a', 'fix-link', segment.status === 'ok' ? 'Éditer' : 'Corriger →');
        link.href = `master-editor.html?route=${encodeURIComponent(series.routeKey)}&seg=${segment.index}`;
        link.addEventListener('click', event => event.stopPropagation());
        fix.appendChild(link);
        row.append(
            element('td', 'num', String(segment.index + 1)),
            name,
            element('td', 'num', km(segment.startKm)),
            element('td', 'num', `${km(segment.distanceKm)} km`),
            element('td', 'num', segment.pkDistanceKm === null ? '—' : `${km(segment.pkDistanceKm)} km`),
            element('td', 'num', formatDuration(segment.durationS)),
            element('td', 'num', kmh(segment.speedKmh)),
            status,
            fix
        );
        row.addEventListener('click', () => selectSegment(state.tableSeries, segment.index, false));
        rowsEl.appendChild(row);
    }
}

function selectSegment(seriesIndex, segmentIndex, scrollTable) {
    if (seriesIndex !== state.tableSeries) {
        state.tableSeries = seriesIndex;
        renderTableDirection();
        renderRows();
    }
    state.selected = { series: seriesIndex, segment: segmentIndex };
    for (const row of rowsEl.children) row.classList.toggle('is-selected', row.dataset.segment === String(segmentIndex));
    state.drawSelection?.();
    if (scrollTable) {
        rowsEl.querySelector(`tr[data-segment="${segmentIndex}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// ---------- Orchestration ----------

function renderAll() {
    rebuildSeries();
    editLink.href = `master-editor.html?route=${encodeURIComponent(state.routeKey)}`;
    renderStats();
    renderChart();
    renderTableDirection();
    renderRows();
    const anomalies = state.series.reduce((sum, series) => sum + series.summary.anomalies.length, 0);
    setStatus(statusEl, anomalies
        ? `${anomalies} segment${anomalies > 1 ? 's' : ''} hors de la plage ${ROUTE_SPEED_BOUNDS_KMH.min}–${ROUTE_SPEED_BOUNDS_KMH.max} km/h : `
            + 'une durée trop courte d’un côté va souvent avec une durée trop longue juste à côté.'
        : 'Toutes les vitesses moyennes sont plausibles.', anomalies ? 'warning' : 'success');
}

function updateDraftBanner(savedAt) {
    if (!savedAt) {
        shell.hideDraft();
        return;
    }
    shell.showDraft(savedAt, [
        {
            label: 'Exporter le JSON',
            kind: 'primary',
            onClick: () => downloadMasterRoutesDocument(buildMasterRoutesDocument(state.data.points, state.data.trajets))
        },
        {
            label: 'Abandonner le brouillon',
            kind: 'ghost danger',
            onClick: () => {
                if (!confirm('Abandonner le brouillon et revenir au fichier versionné ?')) return;
                clearMasterRoutesDraft(state.storage);
                load().catch(showError);
            }
        }
    ]);
}

async function load() {
    const loaded = await loadEditableMasterRoutes();
    Object.assign(state, { data: loaded.data, fileData: loaded.fileData, storage: loaded.storage });
    updateDraftBanner(loaded.draftSavedAt);
    renderAll();
}

function showError(error) {
    setStatus(statusEl, `Erreur de chargement : ${error.message}`, 'error');
}

async function init() {
    for (const [key, config] of Object.entries(MAIN_ROUTES)) {
        const option = element('option', '', config.label);
        option.value = key;
        routeSelect.appendChild(option);
    }
    const requested = readQueryParam('route');
    state.routeKey = MAIN_ROUTES[requested] ? requested : Object.keys(MAIN_ROUTES)[0];
    routeSelect.value = state.routeKey;
    shell.setRouteKey(state.routeKey);

    routeSelect.addEventListener('change', () => {
        state.routeKey = routeSelect.value;
        state.tableSeries = 0;
        shell.setRouteKey(state.routeKey);
        renderAll();
    });
    compareToggle.addEventListener('change', () => {
        state.tableSeries = 0;
        renderAll();
    });
    // Page en lecture seule : elle suit le brouillon des autres onglets sans demander.
    shell.onExternalDraftChange(() => load().catch(showError));

    let frame = 0;
    new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => state.series.length && renderChart());
    }).observe(chartEl);

    await load();
}

init().catch(showError);
