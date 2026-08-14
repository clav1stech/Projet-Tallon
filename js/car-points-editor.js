import { CAR_ROUTES } from './car-config.js';
import { loadDataset } from './csv.js';
import { buildCarRoute, compareRouteProjections, projectRouteLength } from './car-route.js';
import { buildSegmentCandidate } from './functions.js';
import { haversineDistance } from './geo.js';
import {
    applyCarWaypointOverrides,
    loadCarWaypointOverrides,
    migrateCarWaypointOverrides,
    normalizeCarWaypointOverrides,
    saveCarWaypointOverrides
} from './car-waypoint-overrides.js';

const routeSelect = document.getElementById('car-editor-route');
const listEl = document.getElementById('car-point-list');
const statusEl = document.getElementById('car-editor-status');
const importInput = document.getElementById('car-editor-import-file');

const BOTH_ROUTES_VALUE = 'BOTH_DIRECTIONS';
const STRUCTURE_OVERLAP_TOLERANCE_M = 50;
const MARKER_COLLISION_THRESHOLD_KM = 0.03;
const MARKER_OFFSET_PX = 13;
const DIRECTION_META = {
    forward: { shortLabel: 'Mâcon → Combloux', color: '#b43650' },
    reverse: { shortLabel: 'Combloux → Mâcon', color: '#2563b8' }
};

let overrides = loadCarWaypointOverrides();
let currentContexts = [];
let waypointEntries = [];
let entryById = new Map();
let overlapByPairKey = new Map();
let map = null;
let routeLayers = [];
let structureLayers = new Map();
let markers = new Map();
let activeEntryId = null;
const datasetPromises = new Map();

function showStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = type;
}

function directionForConfig(cfg) {
    return cfg?.legs?.some(leg => leg.reverse) ? 'reverse' : 'forward';
}

function pairKeyForSource(sourceKey) {
    return String(sourceKey || '').replace(/:(forward|reverse)$/, '');
}

function entryId(routeKey, sourceKey) {
    return `${routeKey}::${sourceKey}`;
}

function isBothDirections() {
    return routeSelect.value === BOTH_ROUTES_VALUE;
}

function markerIcon(entry) {
    const modified = entry.wp.sourceKey && overrides[entry.wp.sourceKey] ? ' modified' : '';
    const active = entry.id === activeEntryId ? ' active' : '';
    const glyph = entry.wp.type === 'tunnel' ? '🏔' : entry.wp.type === 'col' ? '▲' : entry.wp.type === 'viaduc' ? '⌢' : entry.wp.type === 'peage' ? '€' : entry.wp.type === 'aire' ? 'P' : '●';
    return L.divIcon({
        className: `car-map-marker direction-${entry.direction}${modified}${active}`,
        html: `<span>${glyph}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
}

function structureStyle(entry, active = false) {
    const both = isBothDirections();
    const isTunnel = entry.wp.type === 'tunnel';
    const baseWeight = both
        ? (entry.direction === 'forward' ? 12 : 7)
        : 9;
    return {
        color: DIRECTION_META[entry.direction].color,
        weight: baseWeight + (active ? 3 : 0),
        opacity: active ? 1 : (both ? 0.82 : 0.92),
        dashArray: isTunnel ? '11 8' : null,
        dashOffset: isTunnel && entry.direction === 'reverse' ? '9' : null,
        lineCap: 'butt'
    };
}

function nearestRouteProjection(lat, lon, route, legIndex = null) {
    let best = null;
    for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i];
        const b = route.points[i + 1];
        if (legIndex != null && (a.legIndex !== legIndex || b.legIndex !== legIndex)) continue;
        const candidate = buildSegmentCandidate(a, b, lat, lon);
        if (!candidate || (best && candidate.offsetKm >= best.offsetKm)) continue;
        best = {
            ...candidate,
            lat: a.lat + candidate.ratio * (b.lat - a.lat),
            lon: a.lon + candidate.ratio * (b.lon - a.lon),
            pk: Number.isFinite(a.pk) && Number.isFinite(b.pk)
                ? a.pk + candidate.ratio * (b.pk - a.pk)
                : null,
            segmentIndex: i
        };
    }
    return best;
}

function loadDatasetCached(url) {
    if (!datasetPromises.has(url)) datasetPromises.set(url, loadDataset(url));
    return datasetPromises.get(url);
}

async function buildRouteContext(routeKey) {
    const cfg = CAR_ROUTES[routeKey];
    const datasetsById = {};
    for (const url of cfg.datasets || []) {
        const dataset = await loadDatasetCached(url);
        datasetsById[dataset.descriptor.id] = dataset;
    }
    const effectiveCfg = applyCarWaypointOverrides(cfg, overrides);
    return {
        routeKey,
        cfg,
        direction: directionForConfig(cfg),
        route: buildCarRoute(effectiveCfg, datasetsById)
    };
}

function buildWaypointEntries() {
    waypointEntries = currentContexts.flatMap(context =>
        context.route.waypoints
            .filter(wp => wp.sourceKey)
            .map(wp => ({
                id: entryId(context.routeKey, wp.sourceKey),
                pairKey: pairKeyForSource(wp.sourceKey),
                direction: context.direction,
                context,
                wp,
                markerCollision: false,
                projected: null
            }))
    );

    const groups = new Map();
    for (const entry of waypointEntries) {
        if (!groups.has(entry.pairKey)) groups.set(entry.pairKey, []);
        groups.get(entry.pairKey).push(entry);
    }

    overlapByPairKey = new Map();
    for (const [pairKey, entries] of groups) {
        for (const entry of entries) {
            entry.markerCollision = entries.some(other =>
                other !== entry &&
                other.direction !== entry.direction &&
                haversineDistance(entry.wp.lat, entry.wp.lon, other.wp.lat, other.wp.lon) <= MARKER_COLLISION_THRESHOLD_KM
            );
            if (Number.isFinite(entry.wp.lengthM)) {
                entry.projected = projectRouteLength(
                    entry.context.route,
                    entry.wp.routeKm,
                    entry.wp.lengthM,
                    entry.wp.legIndex
                );
                if (entry.projected.length >= 2) {
                    entry.projected[0] = { ...entry.projected[0], lat: entry.wp.lat, lon: entry.wp.lon };
                }
            }
        }

        const forward = entries.find(entry => entry.direction === 'forward' && entry.projected?.length >= 2);
        const reverse = entries.find(entry => entry.direction === 'reverse' && entry.projected?.length >= 2);
        if (forward && reverse) {
            overlapByPairKey.set(
                pairKey,
                compareRouteProjections(forward.projected, reverse.projected, STRUCTURE_OVERLAP_TOLERANCE_M)
            );
        }
    }
    entryById = new Map(waypointEntries.map(entry => [entry.id, entry]));
}

function routeSummary() {
    const structureCount = waypointEntries.filter(entry => entry.projected?.length >= 2).length;
    if (!isBothDirections()) {
        return `${waypointEntries.length} points modifiables · ${structureCount} ouvrages projetés.`;
    }
    const comparisons = [...overlapByPairKey.values()];
    const validCount = comparisons.filter(result => result.withinTolerance).length;
    return `${waypointEntries.length} repères dans les deux sens · ${structureCount} projections · ` +
        `${validCount}/${comparisons.length} ouvrages superposés à ±${STRUCTURE_OVERLAP_TOLERANCE_M} m.`;
}

async function loadRoute(selection, fit = true) {
    const routeKeys = selection === BOTH_ROUTES_VALUE
        ? Object.keys(CAR_ROUTES)
        : [selection];
    if (!routeKeys.every(key => CAR_ROUTES[key])) return;
    showStatus('Chargement du tracé…');
    currentContexts = await Promise.all(routeKeys.map(buildRouteContext));
    buildWaypointEntries();
    drawRoute(fit);
    const hasMismatch = isBothDirections() && [...overlapByPairKey.values()].some(result => !result.withinTolerance);
    showStatus(routeSummary(), hasMismatch ? 'warning' : '');
}

function routeBounds() {
    const bounds = L.latLngBounds([]);
    for (const context of currentContexts) {
        for (const point of context.route.points) bounds.extend([point.lat, point.lon]);
    }
    return bounds;
}

function markerDisplayLatLng(entry) {
    const base = L.latLng(entry.wp.lat, entry.wp.lon);
    if (!isBothDirections() || !entry.markerCollision) return base;

    const projection = nearestRouteProjection(entry.wp.lat, entry.wp.lon, entry.context.route, entry.wp.legIndex)
        || nearestRouteProjection(entry.wp.lat, entry.wp.lon, entry.context.route);
    if (!projection) return base;
    const a = entry.context.route.points[projection.segmentIndex];
    const b = entry.context.route.points[projection.segmentIndex + 1];
    if (!a || !b) return base;

    const aPx = map.latLngToLayerPoint([a.lat, a.lon]);
    const bPx = map.latLngToLayerPoint([b.lat, b.lon]);
    const basePx = map.latLngToLayerPoint(base);
    const dx = bPx.x - aPx.x;
    const dy = bPx.y - aPx.y;
    const norm = Math.hypot(dx, dy);
    if (norm === 0) return base;

    return map.layerPointToLatLng(L.point(
        basePx.x - (dy / norm) * MARKER_OFFSET_PX,
        basePx.y + (dx / norm) * MARKER_OFFSET_PX
    ));
}

function updateMarkerDisplayPositions() {
    for (const entry of waypointEntries) {
        markers.get(entry.id)?.setLatLng(markerDisplayLatLng(entry));
    }
}

function drawRoute(fit = true) {
    for (const layer of routeLayers) layer.remove();
    routeLayers = [];
    for (const layer of structureLayers.values()) layer.remove();
    structureLayers = new Map();
    for (const marker of markers.values()) marker.remove();
    markers = new Map();

    for (const context of currentContexts) {
        const line = context.route.points.map(point => [point.lat, point.lon]);
        const both = isBothDirections();
        routeLayers.push(L.polyline(line, {
            color: DIRECTION_META[context.direction].color,
            weight: both ? (context.direction === 'forward' ? 6 : 3) : 5,
            opacity: both ? 0.68 : 0.8,
            dashArray: both && context.direction === 'reverse' ? '7 8' : null
        }).addTo(map));
    }
    if (fit) map.fitBounds(routeBounds(), { padding: [24, 24] });

    for (const entry of waypointEntries.filter(item => item.projected?.length >= 2)) {
        const lengthLabel = `${Math.round(entry.wp.lengthM).toLocaleString('fr-FR')} m`;
        const overlap = overlapByPairKey.get(entry.pairKey);
        const overlapLabel = overlap
            ? `<br>Écart aller/retour : ${Math.round(overlap.deviationM)} m ` +
                `(${overlap.withinTolerance ? 'conforme' : 'à vérifier'})`
            : '';
        const layer = L.polyline(
            entry.projected.map(point => [point.lat, point.lon]),
            structureStyle(entry, entry.id === activeEntryId)
        ).addTo(map);
        layer.bindTooltip(
            `${entry.wp.name} · ${lengthLabel}<br>${DIRECTION_META[entry.direction].shortLabel}${overlapLabel}`,
            { sticky: true, direction: 'top' }
        );
        layer.on('click', () => selectWaypoint(entry.id, false));
        structureLayers.set(entry.id, layer);
    }

    for (const entry of waypointEntries) {
        const { wp } = entry;
        const marker = L.marker(markerDisplayLatLng(entry), {
            draggable: true,
            icon: markerIcon(entry),
            title: `${wp.name} — ${DIRECTION_META[entry.direction].shortLabel}`
        }).addTo(map);
        const length = Number.isFinite(wp.lengthM) ? `<br>Longueur : ${Math.round(wp.lengthM).toLocaleString('fr-FR')} m` : '';
        const visualOffset = entry.markerCollision ? '<br><small>Repère légèrement décalé pour rester cliquable</small>' : '';
        marker.bindPopup(
            `<strong>${wp.name}</strong><br>${DIRECTION_META[entry.direction].shortLabel}<br>${wp.type}${length}` +
            `${Number.isFinite(wp.pk) ? `<br>PK ${wp.pk.toFixed(3)}` : ''}${visualOffset}<br><small>Glissez pour corriger</small>`
        );
        marker.on('click', () => selectWaypoint(entry.id, false));
        marker.on('dragend', event => {
            moveWaypoint(entry, event.target).catch(error => showStatus(error.message, 'error'));
        });
        markers.set(entry.id, marker);
    }
    renderList();
}

async function moveWaypoint(entry, marker) {
    const { wp, context } = entry;
    const dropped = marker.getLatLng();
    if (Number.isFinite(wp.pk)) {
        const projection = nearestRouteProjection(dropped.lat, dropped.lng, context.route, wp.legIndex);
        if (!projection || !Number.isFinite(projection.pk)) return;
        overrides[wp.sourceKey] = {
            pk: Number(projection.pk.toFixed(6)),
            lat: Number(projection.lat.toFixed(7)),
            lon: Number(projection.lon.toFixed(7))
        };
    } else {
        overrides[wp.sourceKey] = {
            lat: Number(dropped.lat.toFixed(7)),
            lon: Number(dropped.lng.toFixed(7))
        };
    }

    activeEntryId = entry.id;
    await loadRoute(routeSelect.value, false);
    showStatus(`${wp.name} (${DIRECTION_META[entry.direction].shortLabel}) recalé. ${routeSummary()} Cliquez sur Appliquer pour l’utiliser dans Car Tracker.`, 'success');
}

function selectWaypoint(id, pan = true) {
    activeEntryId = id;
    const entry = entryById.get(id);
    const marker = markers.get(id);
    if (marker && entry) {
        if (pan) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13));
        marker.openPopup();
    }
    renderList();
    for (const item of waypointEntries) {
        markers.get(item.id)?.setIcon(markerIcon(item));
        structureLayers.get(item.id)?.setStyle(structureStyle(item, item.id === activeEntryId));
    }
}

function orderedWaypointEntries() {
    if (!isBothDirections()) return waypointEntries;
    const groups = new Map();
    for (const entry of waypointEntries) {
        if (!groups.has(entry.pairKey)) groups.set(entry.pairKey, []);
        groups.get(entry.pairKey).push(entry);
    }
    return [...groups.values()]
        .sort((left, right) => {
            const leftForward = left.find(entry => entry.direction === 'forward');
            const rightForward = right.find(entry => entry.direction === 'forward');
            return (leftForward?.wp.routeKm ?? Infinity) - (rightForward?.wp.routeKm ?? Infinity);
        })
        .flatMap(entries => entries.sort((a, b) => a.direction === b.direction ? 0 : (a.direction === 'forward' ? -1 : 1)));
}

function renderList() {
    listEl.innerHTML = '';
    for (const entry of orderedWaypointEntries()) {
        const { wp } = entry;
        const button = document.createElement('button');
        const isModified = Boolean(overrides[wp.sourceKey]);
        const overlap = overlapByPairKey.get(entry.pairKey);
        button.type = 'button';
        button.className = `car-point-item direction-${entry.direction}${entry.id === activeEntryId ? ' active' : ''}${isModified ? ' modified' : ''}`;
        const length = Number.isFinite(wp.lengthM)
            ? ` · ${Math.round(wp.lengthM).toLocaleString('fr-FR')} m`
            : '';
        const overlapLabel = overlap
            ? ` · ${overlap.withinTolerance ? '✓' : '⚠'} écart ${Math.round(overlap.deviationM)} m`
            : '';
        const directionBadge = isBothDirections()
            ? `<span class="car-direction-badge">${DIRECTION_META[entry.direction].shortLabel}</span>`
            : '';
        button.innerHTML = `<strong>${wp.name}</strong>${directionBadge}<span class="car-point-meta">${wp.type}${length}${Number.isFinite(wp.pk) ? ` · PK ${wp.pk.toFixed(3)}` : ''}${overlapLabel}</span>`;
        button.addEventListener('click', () => selectWaypoint(entry.id));
        listEl.appendChild(button);
    }
}

function downloadOverrides() {
    const payload = JSON.stringify({ version: 2, overrides: normalizeCarWaypointOverrides(overrides) }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'car-waypoint-overrides.json';
    anchor.click();
    URL.revokeObjectURL(url);
}

async function importOverrides(file) {
    const parsed = JSON.parse(await file.text());
    const migrationCfg = currentContexts[0]?.cfg || Object.values(CAR_ROUTES)[0];
    overrides = migrateCarWaypointOverrides(parsed, migrationCfg);
    saveCarWaypointOverrides(overrides);
    await loadRoute(routeSelect.value, false);
    showStatus(`Corrections importées et appliquées. ${routeSummary()}`, 'success');
}

async function init() {
    if (!globalThis.L) {
        showStatus('La carte n’a pas pu être chargée. Vérifiez la connexion Internet.', 'error');
        return;
    }
    map = L.map('car-map', { preferCanvas: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    map.on('zoomend', updateMarkerDisplayPositions);

    for (const [key, cfg] of Object.entries(CAR_ROUTES)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = cfg.label;
        routeSelect.appendChild(option);
    }
    const bothOption = document.createElement('option');
    bothOption.value = BOTH_ROUTES_VALUE;
    bothOption.textContent = 'Les deux sens';
    routeSelect.appendChild(bothOption);

    routeSelect.addEventListener('change', () => loadRoute(routeSelect.value).catch(error => showStatus(error.message, 'error')));
    document.getElementById('car-editor-save').addEventListener('click', () => {
        overrides = saveCarWaypointOverrides(overrides);
        showStatus(`Corrections appliquées. ${routeSummary()} Rechargez Car Tracker si la page est déjà ouverte.`, 'success');
    });
    document.getElementById('car-editor-export').addEventListener('click', downloadOverrides);
    document.getElementById('car-editor-import').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
        const file = importInput.files?.[0];
        if (file) importOverrides(file).catch(error => showStatus(`Import impossible : ${error.message}`, 'error'));
        importInput.value = '';
    });
    document.getElementById('car-editor-reset').addEventListener('click', () => {
        if (!confirm('Supprimer toutes les corrections locales des points voiture ?')) return;
        overrides = {};
        saveCarWaypointOverrides(overrides);
        loadRoute(routeSelect.value, false).then(() => showStatus(`Corrections locales supprimées. ${routeSummary()}`, 'success'));
    });

    await loadRoute(routeSelect.value);
}

init().catch(error => showStatus(`Erreur : ${error.message}`, 'error'));
