import { MAIN_ROUTES } from './routes-config.js';
import { haversineDistance } from './geo.js';
import {
    buildMasterRoutesDocument,
    downloadMasterRoutesDocument,
    loadMasterRoutes
} from './master-routes-data.js';
import {
    getTrainPointCoordinates,
    resetTrainPointCoordinates,
    setTrainPointCoordinates
} from './train-points-model.js';
import { TRAIN_EDITOR_MAP_CONFIG, TRAIN_EDITOR_VOIES } from './train-points-editor-config.js';
import { getVoieForRoute } from './utils.js';

const routeSelect = document.getElementById('train-editor-route');
const listEl = document.getElementById('train-point-list');
const statusEl = document.getElementById('train-editor-status');
const coordinateEditor = document.getElementById('train-coordinate-editor');
const coordinateTitle = document.getElementById('train-coordinate-title');
const coordinateMeta = document.getElementById('train-coordinate-meta');
const latitudeInput = document.getElementById('train-coordinate-lat');
const longitudeInput = document.getElementById('train-coordinate-lon');

const state = {
    data: null,
    originalData: null,
    contexts: [],
    entries: [],
    selections: new Map(),
    modifiedKeys: new Set(),
    activeEntryKey: null
};

let map = null;
let routeLayers = [];
let markers = new Map();

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

function showStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = type;
}

function routeByConfig(config) {
    return state.data.trajets.find(route => route.id === config.masterRouteId) || null;
}

function pairKey(config) {
    return [config.startPointId, config.endPointId].sort().join('::');
}

function pairLabel(config) {
    const start = state.data.points[config.startPointId]?.name || config.startPointId;
    const end = state.data.points[config.endPointId]?.name || config.endPointId;
    return `${start} ⇄ ${end}`;
}

function renderRouteOptions() {
    routeSelect.innerHTML = '';
    state.selections = new Map();
    const directionGroup = document.createElement('optgroup');
    directionGroup.label = 'Une voie';
    const pairs = new Map();

    for (const [routeKey, config] of Object.entries(MAIN_ROUTES)) {
        const route = routeByConfig(config);
        if (!route) continue;
        const option = document.createElement('option');
        option.value = routeKey;
        option.textContent = `${config.label} · V${getVoieForRoute(route)}`;
        directionGroup.appendChild(option);
        state.selections.set(routeKey, [routeKey]);

        const key = pairKey(config);
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(routeKey);
    }
    routeSelect.appendChild(directionGroup);

    const bothGroup = document.createElement('optgroup');
    bothGroup.label = 'Deux voies';
    for (const [key, routeKeys] of pairs) {
        const voies = new Set(routeKeys.map(routeKey => getVoieForRoute(routeByConfig(MAIN_ROUTES[routeKey]))));
        if (!voies.has(1) || !voies.has(2)) continue;
        const selectionKey = `BOTH::${key}`;
        const option = document.createElement('option');
        option.value = selectionKey;
        option.textContent = `Les deux voies · ${pairLabel(MAIN_ROUTES[routeKeys[0]])}`;
        bothGroup.appendChild(option);
        state.selections.set(selectionKey, routeKeys);
    }
    if (bothGroup.children.length) routeSelect.appendChild(bothGroup);
}

function buildContexts(selectionKey) {
    const routeKeys = state.selections.get(selectionKey) || [];
    return routeKeys.map(routeKey => {
        const config = MAIN_ROUTES[routeKey];
        const route = routeByConfig(config);
        return { routeKey, config, route, voie: getVoieForRoute(route) || 1 };
    });
}

function entryKey(pointId, point, voie) {
    return point.type === 'bifurcation' ? `${pointId}::V${voie}` : pointId;
}

function buildEntries() {
    const entries = new Map();
    const pointOrder = new Map();
    let nextOrder = 0;
    for (const context of state.contexts) {
        for (const [routeIndex, routePoint] of context.route.points.entries()) {
            const point = state.data.points[routePoint.id];
            if (!point) continue;
            if (!pointOrder.has(routePoint.id)) pointOrder.set(routePoint.id, nextOrder++);
            const key = entryKey(routePoint.id, point, context.voie);
            if (!entries.has(key)) {
                entries.set(key, {
                    key,
                    pointId: routePoint.id,
                    point,
                    voie: point.type === 'bifurcation' ? context.voie : null,
                    voies: new Set(),
                    routeIndex,
                    contexts: []
                });
            }
            const entry = entries.get(key);
            entry.voies.add(context.voie);
            entry.contexts.push(context);
        }
    }
    state.entries = [...entries.values()].sort((left, right) => {
        const pointDifference = pointOrder.get(left.pointId) - pointOrder.get(right.pointId);
        if (pointDifference !== 0) return pointDifference;
        return (left.voie || 0) - (right.voie || 0);
    });
}

function coordinatesForEntry(entry) {
    const voie = entry.voie || [...entry.voies][0] || 1;
    return getTrainPointCoordinates(entry.point, voie);
}

function entryCssVoie(entry) {
    const voie = entry.voie || (entry.voies.size === 1 ? [...entry.voies][0] : null);
    return voie ? ` voie-${voie}` : '';
}

function markerGlyph(point) {
    if (point.type === 'gare') return 'G';
    if (point.type === 'bifurcation') return '⑂';
    if (point.type === 'ouvrage_art') return '⌢';
    if (point.type === 'poste_aiguillage') return 'S';
    return '●';
}

function markerIcon(entry) {
    const modified = state.modifiedKeys.has(entry.key) ? ' modified' : '';
    const active = state.activeEntryKey === entry.key ? ' active' : '';
    return L.divIcon({
        className: `train-map-marker${entryCssVoie(entry)}${modified}${active}`,
        html: `<span>${markerGlyph(entry.point)}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
}

function siblingEntry(entry) {
    if (entry.point.type !== 'bifurcation' || state.contexts.length < 2) return null;
    return state.entries.find(candidate => candidate.pointId === entry.pointId && candidate.voie !== entry.voie) || null;
}

function markerDisplayLatLng(entry) {
    const coordinates = coordinatesForEntry(entry);
    const base = L.latLng(coordinates.lat, coordinates.lon);
    const sibling = siblingEntry(entry);
    if (!sibling) return base;
    const siblingCoordinates = coordinatesForEntry(sibling);
    if (haversineDistance(coordinates.lat, coordinates.lon, siblingCoordinates.lat, siblingCoordinates.lon)
        > TRAIN_EDITOR_MAP_CONFIG.markerCollisionThresholdKm) return base;

    const point = map.latLngToLayerPoint(base);
    const direction = entry.voie === 1 ? -1 : 1;
    return map.layerPointToLatLng(L.point(
        point.x + direction * TRAIN_EDITOR_MAP_CONFIG.markerOffsetPx,
        point.y
    ));
}

function updateMarkerDisplayPositions() {
    for (const entry of state.entries) {
        markers.get(entry.key)?.setLatLng(markerDisplayLatLng(entry));
    }
}

function routeCoordinates(context) {
    return context.route.points.map(routePoint => {
        const point = state.data.points[routePoint.id];
        const coordinates = getTrainPointCoordinates(point, context.voie);
        return [coordinates.lat, coordinates.lon];
    });
}

function routeBounds() {
    const bounds = L.latLngBounds([]);
    for (const context of state.contexts) {
        for (const coordinates of routeCoordinates(context)) bounds.extend(coordinates);
    }
    return bounds;
}

function voieDescription(entry) {
    if (entry.voie) return TRAIN_EDITOR_VOIES[entry.voie].label;
    if (entry.voies.size === 2) return 'Point commun aux deux voies';
    return TRAIN_EDITOR_VOIES[[...entry.voies][0] || 1].label;
}

function drawSelection(fit = true) {
    for (const layer of routeLayers) layer.remove();
    routeLayers = [];
    for (const marker of markers.values()) marker.remove();
    markers = new Map();

    const both = state.contexts.length > 1;
    for (const context of state.contexts) {
        const meta = TRAIN_EDITOR_VOIES[context.voie];
        const layer = L.polyline(routeCoordinates(context), {
            color: meta.color,
            weight: both ? (context.voie === 1 ? 6 : 4) : 5,
            opacity: both ? 0.72 : 0.84,
            dashArray: both && context.voie === 2 ? '8 8' : null
        }).addTo(map);
        layer.bindTooltip(`${context.config.label} · ${meta.shortLabel}`, { sticky: true });
        routeLayers.push(layer);
    }

    if (fit) {
        const bounds = routeBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    }

    for (const entry of state.entries) {
        const coordinates = coordinatesForEntry(entry);
        const marker = L.marker(markerDisplayLatLng(entry), {
            draggable: true,
            icon: markerIcon(entry),
            title: `${entry.point.name} — ${voieDescription(entry)}`
        }).addTo(map);
        const source = coordinates.dedicatedToVoie ? 'Coordonnées dédiées à cette voie' : 'Coordonnées communes lat/lon';
        marker.bindPopup(
            `<strong>${escapeHtml(entry.point.name)}</strong><br>${escapeHtml(voieDescription(entry))}`
            + `<br>${escapeHtml(entry.point.type || 'passage')}<br><small>${source} · glissez pour corriger</small>`
        );
        marker.on('click', () => selectEntry(entry.key, false));
        marker.on('dragstart', () => marker.setLatLng([coordinates.lat, coordinates.lon]));
        marker.on('dragend', event => {
            const dropped = event.target.getLatLng();
            updateEntryCoordinates(entry, dropped.lat, dropped.lng, 'Repère déplacé');
        });
        markers.set(entry.key, marker);
    }

    renderList();
    renderCoordinateEditor();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderList() {
    listEl.innerHTML = '';
    for (const [index, entry] of state.entries.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `train-point-item${entryCssVoie(entry)}`
            + `${entry.key === state.activeEntryKey ? ' active' : ''}`
            + `${state.modifiedKeys.has(entry.key) ? ' modified' : ''}`;

        const title = document.createElement('strong');
        title.textContent = `${index + 1}. ${entry.point.name}`;
        const badge = document.createElement('span');
        badge.className = 'train-voie-badge';
        badge.textContent = voieDescription(entry);
        const coordinates = coordinatesForEntry(entry);
        const meta = document.createElement('span');
        meta.className = 'train-point-meta';
        meta.textContent = `${entry.point.type || 'passage'} · ${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}`;

        button.append(title, badge, meta);
        button.addEventListener('click', () => selectEntry(entry.key));
        listEl.appendChild(button);
    }
}

function selectEntry(key, pan = true) {
    state.activeEntryKey = key;
    const entry = state.entries.find(candidate => candidate.key === key);
    const marker = markers.get(key);
    if (entry && marker) {
        if (pan) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14));
        marker.openPopup();
    }
    renderList();
    renderCoordinateEditor();
    for (const item of state.entries) markers.get(item.key)?.setIcon(markerIcon(item));
}

function renderCoordinateEditor() {
    const entry = state.entries.find(candidate => candidate.key === state.activeEntryKey);
    coordinateEditor.classList.toggle('visible', Boolean(entry));
    if (!entry) return;
    const coordinates = coordinatesForEntry(entry);
    coordinateTitle.textContent = entry.point.name;
    const coordinateSource = coordinates.dedicatedToVoie
        ? 'position V dédiée'
        : 'repli actuel sur lat/lon communes';
    coordinateMeta.textContent = entry.point.type === 'bifurcation'
        ? `${TRAIN_EDITOR_VOIES[entry.voie].label} · ${coordinateSource}`
        : `${voieDescription(entry)} · position commune`;
    latitudeInput.value = coordinates.lat;
    longitudeInput.value = coordinates.lon;
}

function validateCoordinates(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw new Error('Latitude ou longitude invalide.');
    }
}

function updateEntryCoordinates(entry, lat, lon, actionLabel) {
    try {
        validateCoordinates(lat, lon);
        setTrainPointCoordinates(entry.point, entry.voie || [...entry.voies][0] || 1,
            Number(lat.toFixed(7)), Number(lon.toFixed(7)));
        state.modifiedKeys.add(entry.key);
        state.activeEntryKey = entry.key;
        refreshSelection(false);
        showStatus(`${actionLabel} pour ${entry.point.name}. ${selectionSummary()}`, 'success');
    } catch (error) {
        showStatus(error.message, 'error');
        refreshSelection(false);
    }
}

function resetActiveEntry() {
    const entry = state.entries.find(candidate => candidate.key === state.activeEntryKey);
    if (!entry) return;
    resetTrainPointCoordinates(
        entry.point,
        state.originalData.points[entry.pointId],
        entry.voie || [...entry.voies][0] || 1
    );
    state.modifiedKeys.delete(entry.key);
    refreshSelection(false);
    showStatus(`${entry.point.name} a retrouvé sa position d’origine. ${selectionSummary()}`, 'success');
}

function selectionSummary() {
    const voies = [...new Set(state.contexts.map(context => `V${context.voie}`))].join(' + ');
    const modified = state.modifiedKeys.size;
    return `${state.entries.length} repères · ${voies} · ${modified} correction${modified > 1 ? 's' : ''}.`;
}

function refreshSelection(fit = true) {
    state.contexts = buildContexts(routeSelect.value);
    buildEntries();
    if (!state.entries.some(entry => entry.key === state.activeEntryKey)) state.activeEntryKey = null;
    drawSelection(fit);
}

async function init() {
    if (!globalThis.L) {
        showStatus('La carte n’a pas pu être chargée. Vérifiez la connexion Internet.', 'error');
        return;
    }
    state.data = await loadMasterRoutes();
    state.originalData = cloneData(state.data);

    map = L.map('train-map', { preferCanvas: true });
    const baseLayer = L.tileLayer(
        TRAIN_EDITOR_MAP_CONFIG.baseTiles.url,
        TRAIN_EDITOR_MAP_CONFIG.baseTiles.options
    ).addTo(map);
    const railwayLayer = L.tileLayer(
        TRAIN_EDITOR_MAP_CONFIG.railwayTiles.url,
        TRAIN_EDITOR_MAP_CONFIG.railwayTiles.options
    ).addTo(map);
    L.control.layers(
        { OpenStreetMap: baseLayer },
        { 'Voies ferrées · OpenRailwayMap': railwayLayer },
        { collapsed: false }
    ).addTo(map);
    map.on('zoomend', updateMarkerDisplayPositions);

    renderRouteOptions();
    routeSelect.addEventListener('change', () => {
        state.activeEntryKey = null;
        refreshSelection();
        showStatus(selectionSummary());
    });
    document.getElementById('train-editor-export').addEventListener('click', () => {
        try {
            const data = buildMasterRoutesDocument(state.data.points, state.data.trajets);
            downloadMasterRoutesDocument(data);
            showStatus(`Export JSON validé. ${selectionSummary()}`, 'success');
        } catch (error) {
            showStatus(error.message, 'error');
        }
    });
    document.getElementById('train-editor-reset').addEventListener('click', () => {
        if (!state.modifiedKeys.size) return;
        if (!confirm('Annuler toutes les corrections cartographiques de cette session ?')) return;
        state.data = cloneData(state.originalData);
        state.modifiedKeys.clear();
        state.activeEntryKey = null;
        refreshSelection(false);
        showStatus(`Toutes les corrections ont été annulées. ${selectionSummary()}`, 'success');
    });
    document.getElementById('train-coordinate-apply').addEventListener('click', () => {
        const entry = state.entries.find(candidate => candidate.key === state.activeEntryKey);
        if (!entry) return;
        updateEntryCoordinates(entry, Number(latitudeInput.value), Number(longitudeInput.value), 'Coordonnées appliquées');
    });
    document.getElementById('train-coordinate-reset').addEventListener('click', resetActiveEntry);
    for (const input of [latitudeInput, longitudeInput]) {
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') document.getElementById('train-coordinate-apply').click();
        });
    }

    refreshSelection();
    showStatus(selectionSummary());
}

init().catch(error => showStatus(`Erreur : ${error.message}`, 'error'));
