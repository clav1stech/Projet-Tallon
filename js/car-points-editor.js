import { CAR_ROUTES } from './car-config.js';
import { loadDataset } from './csv.js';
import { buildCarRoute } from './car-route.js';
import { buildSegmentCandidate } from './functions.js';
import {
    applyCarWaypointOverrides,
    loadCarWaypointOverrides,
    normalizeCarWaypointOverrides,
    saveCarWaypointOverrides
} from './car-waypoint-overrides.js';

const routeSelect = document.getElementById('car-editor-route');
const listEl = document.getElementById('car-point-list');
const statusEl = document.getElementById('car-editor-status');
const importInput = document.getElementById('car-editor-import-file');

let overrides = loadCarWaypointOverrides();
let currentRoute = null;
let map = null;
let routeLayer = null;
let markers = new Map();
let activeKey = null;

function showStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = type;
}

function markerIcon(wp) {
    const modified = wp.sourceKey && overrides[wp.sourceKey] ? ' modified' : '';
    const active = wp.sourceKey === activeKey ? ' active' : '';
    const glyph = wp.type === 'tunnel' ? '🏔' : wp.type === 'viaduc' ? '⌢' : wp.type === 'peage' ? '€' : '●';
    return L.divIcon({
        className: `car-map-marker${modified}${active}`,
        html: `<span>${glyph}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
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

async function loadRoute(routeKey, fit = true) {
    const cfg = CAR_ROUTES[routeKey];
    if (!cfg) return;
    showStatus('Chargement du tracé…');
    const datasetsById = {};
    for (const url of cfg.datasets || []) {
        const dataset = await loadDataset(url);
        datasetsById[dataset.descriptor.id] = dataset;
    }
    const effectiveCfg = applyCarWaypointOverrides(cfg, overrides);
    currentRoute = buildCarRoute(effectiveCfg, datasetsById);
    drawRoute(fit);
    showStatus(`${currentRoute.waypoints.filter(wp => wp.sourceKey).length} points modifiables affichés.`);
}

function drawRoute(fit = true) {
    routeLayer?.remove();
    for (const marker of markers.values()) marker.remove();
    markers = new Map();

    const line = currentRoute.points.map(point => [point.lat, point.lon]);
    routeLayer = L.polyline(line, { color: '#a9324c', weight: 5, opacity: 0.8 }).addTo(map);
    if (fit) map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] });

    for (const wp of currentRoute.waypoints.filter(item => item.sourceKey)) {
        const marker = L.marker([wp.lat, wp.lon], { draggable: true, icon: markerIcon(wp), title: wp.name }).addTo(map);
        marker.bindPopup(`<strong>${wp.name}</strong><br>${wp.type}${Number.isFinite(wp.pk) ? `<br>PK ${wp.pk.toFixed(3)}` : ''}<br><small>Glissez pour corriger</small>`);
        marker.on('click', () => selectWaypoint(wp.sourceKey, false));
        marker.on('dragend', event => {
            moveWaypoint(wp, event.target).catch(error => showStatus(error.message, 'error'));
        });
        markers.set(wp.sourceKey, marker);
    }
    renderList();
}

async function moveWaypoint(wp, marker) {
    const dropped = marker.getLatLng();
    if (Number.isFinite(wp.pk)) {
        const projection = nearestRouteProjection(dropped.lat, dropped.lng, currentRoute, wp.legIndex);
        if (!projection || !Number.isFinite(projection.pk)) return;
        marker.setLatLng([projection.lat, projection.lon]);
        overrides[wp.sourceKey] = { pk: Number(projection.pk.toFixed(6)) };
    } else {
        overrides[wp.sourceKey] = {
            lat: Number(dropped.lat.toFixed(7)),
            lon: Number(dropped.lng.toFixed(7))
        };
    }

    activeKey = wp.sourceKey;
    await loadRoute(routeSelect.value, false);
    showStatus(`${wp.name} recalé. Cliquez sur Appliquer pour l'utiliser dans Car Tracker.`, 'success');
}

function selectWaypoint(key, pan = true) {
    activeKey = key;
    const wp = currentRoute.waypoints.find(item => item.sourceKey === key);
    const marker = markers.get(key);
    if (marker && wp) {
        if (pan) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13));
        marker.openPopup();
    }
    renderList();
    for (const item of currentRoute.waypoints.filter(point => point.sourceKey)) {
        markers.get(item.sourceKey)?.setIcon(markerIcon(item));
    }
}

function renderList() {
    listEl.innerHTML = '';
    for (const wp of currentRoute.waypoints.filter(item => item.sourceKey)) {
        const button = document.createElement('button');
        const isModified = Boolean(overrides[wp.sourceKey]);
        button.type = 'button';
        button.className = `car-point-item${wp.sourceKey === activeKey ? ' active' : ''}${isModified ? ' modified' : ''}`;
        button.innerHTML = `<strong>${wp.name}</strong><span class="car-point-meta">${wp.type}${Number.isFinite(wp.pk) ? ` · PK ${wp.pk.toFixed(3)}` : ''}</span>`;
        button.addEventListener('click', () => selectWaypoint(wp.sourceKey));
        listEl.appendChild(button);
    }
}

function downloadOverrides() {
    const payload = JSON.stringify({ version: 1, overrides: normalizeCarWaypointOverrides(overrides) }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'car-waypoint-overrides.json';
    anchor.click();
    URL.revokeObjectURL(url);
}

async function importOverrides(file) {
    const parsed = JSON.parse(await file.text());
    overrides = normalizeCarWaypointOverrides(parsed);
    saveCarWaypointOverrides(overrides);
    await loadRoute(routeSelect.value, false);
    showStatus('Corrections importées et appliquées.', 'success');
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

    for (const [key, cfg] of Object.entries(CAR_ROUTES)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = cfg.label;
        routeSelect.appendChild(option);
    }
    routeSelect.addEventListener('change', () => loadRoute(routeSelect.value).catch(error => showStatus(error.message, 'error')));
    document.getElementById('car-editor-save').addEventListener('click', () => {
        overrides = saveCarWaypointOverrides(overrides);
        showStatus('Corrections appliquées. Rechargez Car Tracker si la page est déjà ouverte.', 'success');
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
        loadRoute(routeSelect.value, false).then(() => showStatus('Corrections locales supprimées.', 'success'));
    });

    await loadRoute(routeSelect.value);
}

init().catch(error => showStatus(`Erreur : ${error.message}`, 'error'));
