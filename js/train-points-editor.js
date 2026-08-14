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
    setTrainPointCoordinates,
    usesTrainVoieCoordinates
} from './train-points-model.js';
import {
    TRAIN_EDITOR_MAP_CONFIG,
    TRAIN_EDITOR_STRUCTURE_STYLE,
    TRAIN_EDITOR_VOIES
} from './train-points-editor-config.js';
import {
    applyStructureEndpointSuggestions,
    loadRailCorridors,
    snapToRailCorridor,
    structureLengthMeters,
    structurePathOnCorridor,
    validateStructureEndpoints
} from './train-structure-endpoints.js';
import { buildTrainRoutePolyline } from './train-map-polyline.js';
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
    derivedEndpointKeys: new Set(),
    railCorridors: new Map(),
    activeEntryKey: null
};

let map = null;
let routeLayers = [];
let structureLayers = [];
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
    return usesTrainVoieCoordinates(point) ? `${pointId}::V${voie}` : pointId;
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
                    voie: usesTrainVoieCoordinates(point) ? context.voie : null,
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
    if (point.type === 'ouvrage_art') return /tunnel|tranchée/i.test(point.name) ? 'T' : '⌢';
    if (point.type === 'poste_aiguillage') return 'S';
    return '●';
}

function markerIcon(entry) {
    const modified = state.modifiedKeys.has(entry.key) ? ' modified' : '';
    const suggested = state.derivedEndpointKeys.has(entry.key) ? ' suggested' : '';
    const needsPositioning = entryNeedsPositioning(entry) ? ' needs-positioning' : '';
    const active = state.activeEntryKey === entry.key ? ' active' : '';
    return L.divIcon({
        className: `train-map-marker${entryCssVoie(entry)}${modified}${suggested}${needsPositioning}${active}`,
        html: `<span>${markerGlyph(entry.point)}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
}

function entryNeedsPositioning(entry) {
    return entry.point.type === 'ouvrage_art'
        && entry.voie === 2
        && !getTrainPointCoordinates(entry.point, 2).dedicatedToVoie;
}

function siblingEntry(entry) {
    if (!usesTrainVoieCoordinates(entry.point) || state.contexts.length < 2) return null;
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
    return buildTrainRoutePolyline(
        state.data.points,
        context.route,
        context.voie,
        state.railCorridors
    ).map(point => [point.lat, point.lon]);
}

function routeBounds(contextPaths) {
    const bounds = L.latLngBounds([]);
    for (const { coordinates } of contextPaths) {
        for (const point of coordinates) bounds.extend(point);
    }
    return bounds;
}

function voieDescription(entry) {
    if (entry.voie) return TRAIN_EDITOR_VOIES[entry.voie].label;
    if (entry.voies.size === 2) return 'Point commun aux deux voies';
    return TRAIN_EDITOR_VOIES[[...entry.voies][0] || 1].label;
}

function corridorForPoint(point) {
    const declared = state.railCorridors.get(String(point.code_ligne || ''));
    if (declared) return declared;
    let best = null;
    for (const corridor of state.railCorridors.values()) {
        const snapped = snapToRailCorridor(corridor, point.lat_V1 ?? point.lat, point.lon_V1 ?? point.lon);
        if (snapped && (!best || snapped.offsetKm < best.offsetKm)) best = { corridor, offsetKm: snapped.offsetKm };
    }
    return best?.corridor || null;
}

function drawSelection(fit = true) {
    for (const layer of routeLayers) layer.remove();
    routeLayers = [];
    for (const layer of structureLayers) layer.remove();
    structureLayers = [];
    for (const marker of markers.values()) marker.remove();
    markers = new Map();

    const both = state.contexts.length > 1;
    const contextPaths = state.contexts.map(context => ({
        context,
        coordinates: routeCoordinates(context)
    }));
    for (const { context, coordinates } of contextPaths) {
        const meta = TRAIN_EDITOR_VOIES[context.voie];
        const layer = L.polyline(coordinates, {
            color: meta.color,
            weight: both ? (context.voie === 1 ? 6 : 4) : 5,
            opacity: both ? 0.72 : 0.84,
            dashArray: both && context.voie === 2 ? '8 8' : null
        }).addTo(map);
        layer.bindTooltip(`${context.config.label} · ${meta.shortLabel}`, { sticky: true });
        routeLayers.push(layer);
    }

    const structures = new Map(
        state.entries
            .filter(entry => entry.point.type === 'ouvrage_art')
            .map(entry => [entry.pointId, entry.point])
    );
    for (const [pointId, point] of structures) {
        const voie1 = getTrainPointCoordinates(point, 1);
        const voie2 = getTrainPointCoordinates(point, 2);
        if (!voie2.dedicatedToVoie) continue;
        const corridor = corridorForPoint(point);
        const path = structurePathOnCorridor(point, corridor)
            || [{ lat: voie1.lat, lon: voie1.lon }, { lat: voie2.lat, lon: voie2.lon }];
        const lengthM = structureLengthMeters(point);
        const layer = L.polyline(path.map(coordinate => [coordinate.lat, coordinate.lon]), {
            ...TRAIN_EDITOR_STRUCTURE_STYLE,
            dashArray: /tunnel|tranchée/i.test(point.name) ? '10 7' : null
        }).addTo(map);
        layer.bindTooltip(
            `${escapeHtml(point.name)}${lengthM ? ` · ${Math.round(lengthM).toLocaleString('fr-FR')} m` : ''}`,
            { sticky: true }
        );
        const selectableKey = state.entries.find(entry => entry.pointId === pointId)?.key;
        if (selectableKey) layer.on('click', () => selectEntry(selectableKey, false));
        structureLayers.push(layer);
    }

    if (fit) {
        const bounds = routeBounds(contextPaths);
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    }

    for (const entry of state.entries) {
        const coordinates = coordinatesForEntry(entry);
        const marker = L.marker(markerDisplayLatLng(entry), {
            draggable: true,
            icon: markerIcon(entry),
            title: `${entry.point.name} — ${voieDescription(entry)}`
        }).addTo(map);
        const source = entryNeedsPositioning(entry)
            ? 'Entrée V2 à positionner sur la polyline'
            : state.derivedEndpointKeys.has(entry.key)
            ? 'Extrémité calculée sur la polyline selon la longueur'
            : (coordinates.dedicatedToVoie ? 'Coordonnées dédiées à cette voie' : 'Coordonnées communes lat/lon');
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
            + `${state.modifiedKeys.has(entry.key) ? ' modified' : ''}`
            + `${state.derivedEndpointKeys.has(entry.key) ? ' suggested' : ''}`
            + `${entryNeedsPositioning(entry) ? ' needs-positioning' : ''}`;

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
        ? (state.derivedEndpointKeys.has(entry.key) ? 'position calculée sur la polyline' : 'position V dédiée')
        : (entryNeedsPositioning(entry) ? 'entrée V2 à positionner' : 'repli actuel sur lat/lon communes');
    coordinateMeta.textContent = usesTrainVoieCoordinates(entry.point)
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
        if (entry.point.type === 'ouvrage_art') {
            const corridor = corridorForPoint(entry.point);
            const snapped = snapToRailCorridor(corridor, lat, lon);
            if (snapped) ({ lat, lon } = snapped);
        }
        setTrainPointCoordinates(entry.point, entry.voie || [...entry.voies][0] || 1,
            Number(lat.toFixed(7)), Number(lon.toFixed(7)));
        state.modifiedKeys.add(entry.key);
        state.derivedEndpointKeys.delete(entry.key);
        if (entry.point.type === 'ouvrage_art' && entry.voie === 1) {
            refreshDerivedStructureEndpoint(entry.pointId);
        }
        state.activeEntryKey = entry.key;
        refreshSelection(false);
        showStatus(`${actionLabel} pour ${entry.point.name}. ${selectionSummary()}`, 'success');
    } catch (error) {
        showStatus(error.message, 'error');
        refreshSelection(false);
    }
}

function applyAutomaticStructureEndpoints() {
    const suggestions = applyStructureEndpointSuggestions(state.data.points, state.railCorridors);
    for (const pointId of suggestions.keys()) state.derivedEndpointKeys.add(`${pointId}::V2`);
}

function refreshDerivedStructureEndpoint(pointId) {
    const key = `${pointId}::V2`;
    if (!state.derivedEndpointKeys.has(key)) return;
    const point = state.data.points[pointId];
    delete point.lat_V2;
    delete point.lon_V2;
    state.derivedEndpointKeys.delete(key);
    const suggestions = applyStructureEndpointSuggestions({ [pointId]: point }, state.railCorridors);
    if (suggestions.has(pointId)) state.derivedEndpointKeys.add(key);
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
    state.derivedEndpointKeys.delete(entry.key);
    if (entry.point.type === 'ouvrage_art') {
        const v2Key = `${entry.pointId}::V2`;
        const shouldRefreshV2 = entry.voie === 2 || state.derivedEndpointKeys.has(v2Key);
        if (shouldRefreshV2) {
            delete entry.point.lat_V2;
            delete entry.point.lon_V2;
            state.derivedEndpointKeys.delete(v2Key);
        }
        const suggestions = applyStructureEndpointSuggestions(
            { [entry.pointId]: entry.point },
            state.railCorridors
        );
        if (suggestions.has(entry.pointId)) state.derivedEndpointKeys.add(v2Key);
    }
    refreshSelection(false);
    showStatus(`${entry.point.name} a retrouvé sa position d’origine. ${selectionSummary()}`, 'success');
}

function selectionSummary() {
    const voies = [...new Set(state.contexts.map(context => `V${context.voie}`))].join(' + ');
    const modified = state.modifiedKeys.size;
    const derived = state.derivedEndpointKeys.size;
    const missing = Object.values(state.data.points).filter(point => point.type === 'ouvrage_art'
        && (!Number.isFinite(point.lat_V2) || !Number.isFinite(point.lon_V2))).length;
    return `${state.entries.length} repères · ${voies} · ${modified} correction${modified > 1 ? 's' : ''}`
        + ` · ${derived} extrémité${derived > 1 ? 's' : ''} calculée${derived > 1 ? 's' : ''}`
        + ` · ${missing} à positionner.`;
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
    state.railCorridors = await loadRailCorridors(TRAIN_EDITOR_MAP_CONFIG.railDatasetDescriptorUrl);
    applyAutomaticStructureEndpoints();

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
            const endpointValidation = validateStructureEndpoints(
                state.data.points,
                TRAIN_EDITOR_MAP_CONFIG.minStructureEndpointDistanceM
            );
            if (!endpointValidation.valid) {
                throw new Error(`Export refusé : ${endpointValidation.errors.join(' ')}`);
            }
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
        state.derivedEndpointKeys.clear();
        applyAutomaticStructureEndpoints();
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
