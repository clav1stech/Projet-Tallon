// js/master-editor.js
// Éditeur des trajets de data/masterRoutes.normalized.json : points, types,
// PK et durées entre points. Chaque modification va dans le brouillon partagé
// des éditeurs (master-routes-draft.js) ; seul l'export JSON, recopié à la main
// sur le fichier, atteint l'application.

import { MAIN_ROUTES } from './routes-config.js';
import { buildMasterRoutesDocument, downloadMasterRoutesDocument } from './master-routes-data.js';
import {
    clearMasterRoutesDraft,
    loadEditableMasterRoutes,
    writeMasterRoutesDraft
} from './master-routes-draft.js';
import {
    buildRouteSegments,
    formatDuration,
    parseDurationInput,
    routePointCoordinates,
    summarizeRouteSegments
} from './route-speed.js';
import { haversineDistance } from './geo.js';
import { ROUTE_SPEED_BOUNDS_KMH } from './train-config.js';
import {
    mountEditorShell,
    readQueryParam,
    setStatus,
    showReloadNotice
} from './editor-shell.js';

const UNDO_LIMIT = 60;
// Une distance PK plus courte que le vol d'oiseau est géométriquement
// impossible : au-delà de cette marge, une coordonnée ou un PK est faux.
const PK_SHORTER_THAN_GPS_RATIO = 0.97;
const PK_CHECK_MIN_KM = 0.3;
// Coordonnées communes trop loin de l'entrée de voie : elles ne servent qu'en
// repli, mais trompent l'œil (et la carte) quand elles divergent.
const SHARED_COORDINATE_DRIFT_KM = 2;
const SPEED_STRIP_MAX_KMH = 360;

const POINT_TYPES = [
    { value: 'passage', label: 'Passage', glyph: '●' },
    { value: 'gare', label: 'Gare', glyph: 'G' },
    { value: 'ouvrage_art', label: 'Ouvrage d’art', glyph: '⌢' },
    { value: 'bifurcation', label: 'Bifurcation', glyph: '⑂' },
    { value: 'poste_aiguillage', label: 'Poste d’aiguillage (PRS/SEI/PRCI)', glyph: 'S' }
];

const STATUS_LABELS = {
    'too-fast': { label: 'Trop rapide', icon: 'fa-exclamation-triangle' },
    'too-slow': { label: 'Trop lent', icon: 'fa-hourglass-half' },
    'no-duration': { label: 'Durée manquante', icon: 'fa-question-circle' }
};

const OPTIONAL_NUMBER_FIELDS = new Set(['Vmax', 'altitude', 'longueur']);
const COORDINATE_FIELDS = new Set(['lat', 'lon', 'lat_V1', 'lon_V1', 'lat_V2', 'lon_V2']);

const routePicker = document.getElementById('route-picker');
const voiePicker = document.getElementById('voie-picker');
const anomaliesOnly = document.getElementById('anomalies-only');
const undoButton = document.getElementById('undo-btn');
const pointsList = document.getElementById('points-list');
const statsEl = document.getElementById('route-stats');
const barsEl = document.getElementById('speed-bars');
const statusEl = document.getElementById('editor-status');
const profileLink = document.getElementById('profile-link');

const shell = mountEditorShell({ active: 'routes' });

const state = {
    data: null,
    fileData: null,
    storage: null,
    routeKey: '',
    openPointIds: new Set(),
    undo: [],
    segments: [],
    anomalyCursor: -1
};

let segmentViews = [];
let pointViews = [];

// ---------- Accès ----------

function currentRoute() {
    const config = MAIN_ROUTES[state.routeKey];
    return config ? state.data.trajets.find(route => route.id === config.masterRouteId) || null : null;
}

function currentVoie() {
    return currentRoute()?.voie === 2 ? 2 : 1;
}

function pointAt(index) {
    const routePoint = currentRoute()?.points[index];
    return routePoint ? state.data.points[routePoint.id] : null;
}

/** Points nommés par la configuration de l'app : les retirer casserait le sélecteur. */
function appReferences(pointId) {
    return Object.entries(MAIN_ROUTES)
        .filter(([, config]) => config.startPointId === pointId
            || config.endPointId === pointId
            || config.stopOptions.some(option => option.id === pointId))
        .map(([, config]) => config.label);
}

// ---------- Mutations ----------

/**
 * Point d'entrée unique des modifications : instantané pour l'annulation,
 * enregistrement du brouillon, puis rendu (complet si la structure change).
 */
function commit(mutator, { structural = false } = {}) {
    const snapshot = JSON.stringify(state.data);
    const result = mutator();
    if (result === false) return false;
    state.undo.push(snapshot);
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
    persist();
    if (structural) render();
    else refreshComputed();
    return true;
}

function persist() {
    undoButton.disabled = state.undo.length === 0;
    try {
        const savedAt = writeMasterRoutesDraft(state.storage, state.data, state.fileData);
        updateDraftBanner(savedAt);
    } catch (error) {
        setStatus(statusEl, `${error.message} La modification reste en mémoire dans cette page.`, 'warning');
    }
}

function updateDraftBanner(savedAt) {
    if (!savedAt) {
        shell.hideDraft();
        return;
    }
    shell.showDraft(savedAt, [
        { label: 'Exporter le JSON', kind: 'primary', onClick: exportJson },
        { label: 'Abandonner le brouillon', kind: 'ghost danger', onClick: discardDraft }
    ]);
}

function undo() {
    const snapshot = state.undo.pop();
    if (!snapshot) return;
    state.data = JSON.parse(snapshot);
    persist();
    render();
    setStatus(statusEl, 'Dernière modification annulée.', 'success');
}

function discardDraft() {
    if (!confirm('Abandonner le brouillon et revenir au fichier versionné ? Les modifications non exportées seront perdues.')) return;
    clearMasterRoutesDraft(state.storage);
    state.data = structuredClone(state.fileData);
    state.undo = [];
    persist();
    render();
    setStatus(statusEl, 'Brouillon abandonné : retour au fichier versionné.', 'success');
}

function setPointField(index, field, rawValue) {
    const routePoint = currentRoute()?.points[index];
    const point = pointAt(index);
    if (!point) return;
    const text = String(rawValue ?? '').trim();

    if (COORDINATE_FIELDS.has(field)) {
        if (text === '' && field.includes('_V')) {
            const axisPartner = field.startsWith('lat') ? field.replace('lat', 'lon') : field.replace('lon', 'lat');
            commit(() => { delete point[field]; delete point[axisPartner]; });
            setStatus(statusEl, `Entrée ${field.slice(-2)} retirée : la voie se replie sur les coordonnées communes.`, 'success');
            render();
            return;
        }
        const value = Number(text.replace(',', '.'));
        const limit = field.startsWith('lat') ? 90 : 180;
        if (!Number.isFinite(value) || Math.abs(value) > limit) {
            setStatus(statusEl, `Coordonnée invalide pour ${field} : ${text || 'vide'}.`, 'error');
            refreshComputed();
            return;
        }
        commit(() => { point[field] = value; });
        return;
    }
    if (OPTIONAL_NUMBER_FIELDS.has(field)) {
        const value = text === '' ? null : Number(text.replace(',', '.'));
        if (value !== null && !Number.isFinite(value)) {
            setStatus(statusEl, `Valeur numérique invalide pour ${field}.`, 'error');
            return;
        }
        commit(() => { point[field] = value; });
        return;
    }
    if (field === 'name' && !text) {
        setStatus(statusEl, 'Un point doit garder un nom.', 'error');
        refreshComputed();
        return;
    }
    if (routePoint && field === 'id') {
        renamePoint(routePoint.id, text);
        return;
    }
    commit(() => { point[field] = text; });
}

function renamePoint(oldId, rawId) {
    const newId = rawId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!newId || newId === oldId) return;
    if (state.data.points[newId]) {
        setStatus(statusEl, `L’identifiant ${newId} existe déjà.`, 'error');
        render();
        return;
    }
    const references = appReferences(oldId);
    if (references.length) {
        setStatus(statusEl, `${oldId} est nommé dans js/routes-config.js (${references.join(', ')}) : `
            + 'renommez-le aussi là-bas, puis ici.', 'error');
        render();
        return;
    }
    commit(() => {
        state.data.points[newId] = state.data.points[oldId];
        delete state.data.points[oldId];
        for (const route of state.data.trajets) {
            for (const routePoint of route.points) if (routePoint.id === oldId) routePoint.id = newId;
        }
        if (state.openPointIds.delete(oldId)) state.openPointIds.add(newId);
    }, { structural: true });
    setStatus(statusEl, `${oldId} renommé en ${newId} dans tous les trajets.`, 'success');
}

/**
 * Change le type d'un point en migrant ses champs : une bifurcation porte ses
 * PK et coordonnées par voie, un ouvrage d'art ses entrées par voie.
 */
function changePointType(index, newType) {
    const point = pointAt(index);
    if (!point || (point.type || 'passage') === newType) return;
    commit(() => {
        const oldType = point.type || 'passage';
        if (newType === 'bifurcation') {
            const pk = point.PK ?? '';
            delete point.PK;
            delete point.longueur;
            Object.assign(point, { code_ligne_2: '', PK_V1: pk, PK_V2: pk, PK_2_V1: '', PK_2_V2: '' });
            for (const voie of [1, 2]) {
                point[`lat_V${voie}`] ??= point.lat;
                point[`lon_V${voie}`] ??= point.lon;
            }
        } else if (oldType === 'bifurcation') {
            const pk = point.PK_V1 ?? '';
            if (Number.isFinite(point.lat_V1)) { point.lat = point.lat_V1; point.lon = point.lon_V1; }
            for (const field of ['code_ligne_2', 'PK_V1', 'PK_V2', 'PK_2_V1', 'PK_2_V2', 'lat_V1', 'lon_V1', 'lat_V2', 'lon_V2']) {
                delete point[field];
            }
            point.PK = pk;
            point.longueur = null;
        }
        if (oldType === 'ouvrage_art' && newType !== 'ouvrage_art' && newType !== 'bifurcation') {
            point.longueur = null;
            for (const field of ['lat_V1', 'lon_V1', 'lat_V2', 'lon_V2']) delete point[field];
        }
        point.type = newType;
    }, { structural: true });
}

function setDuration(index, seconds) {
    const routePoint = currentRoute()?.points[index];
    if (!routePoint || routePoint.durationToNext === seconds) return;
    commit(() => { routePoint.durationToNext = seconds; });
}

function newPointId() {
    let id = `NOUVEAU_POINT_${Date.now().toString(36).toUpperCase()}`;
    while (state.data.points[id]) id += '_';
    return id;
}

/**
 * Insère un point après `index`, au milieu du segment, qui se partage la
 * durée : les vitesses voisines restent plausibles et le total ne bouge pas.
 */
function insertPointAfter(index) {
    const route = currentRoute();
    if (!route) return;
    const voie = currentVoie();
    const from = routePointCoordinates(pointAt(index), voie);
    const isLast = index === route.points.length - 1;
    const to = isLast ? { lat: from.lat - 0.01, lon: from.lon } : routePointCoordinates(pointAt(index + 1), voie);
    const id = newPointId();
    commit(() => {
        state.data.points[id] = {
            name: 'Nouveau point',
            lat: Number(((from.lat + to.lat) / 2).toFixed(6)),
            lon: Number(((from.lon + to.lon) / 2).toFixed(6)),
            type: 'passage',
            code_ligne: '',
            PK: '',
            Vmax: null,
            altitude: null,
            longueur: null
        };
        const duration = Number(route.points[index].durationToNext) || 0;
        const first = isLast ? 60 : Math.round(duration / 2);
        route.points[index].durationToNext = first;
        route.points.splice(index + 1, 0, { id, durationToNext: isLast ? 0 : duration - first });
        state.openPointIds.add(id);
    }, { structural: true });
    setStatus(statusEl, 'Point inséré au milieu du segment, durée partagée : renseignez son nom, ses coordonnées et son PK.', 'success');
    pointViews[index + 1]?.row.querySelector('input[data-field="name"]')?.focus();
}

function deletePoint(index) {
    const route = currentRoute();
    const routePoint = route?.points[index];
    if (!routePoint) return;
    const point = state.data.points[routePoint.id];
    const references = appReferences(routePoint.id);
    if (references.length) {
        setStatus(statusEl, `${point.name} est un départ, un terminus ou un arrêt proposé par l’app `
            + `(${references.join(', ')}) : retirez-le d’abord de js/routes-config.js.`, 'error');
        return;
    }
    if (route.points.length <= 2) {
        setStatus(statusEl, 'Un trajet garde au moins deux points.', 'error');
        return;
    }
    const carried = index > 0 && index < route.points.length - 1 ? Number(routePoint.durationToNext) || 0 : 0;
    const question = carried
        ? `Retirer « ${point.name} » du trajet ? Sa durée (${formatDuration(carried)}) est reportée sur le segment précédent.`
        : `Retirer « ${point.name} » du trajet ?`;
    if (!confirm(question)) return;
    commit(() => {
        if (carried) route.points[index - 1].durationToNext += carried;
        route.points.splice(index, 1);
        const stillUsed = state.data.trajets.some(other => other.points.some(item => item.id === routePoint.id));
        if (!stillUsed) delete state.data.points[routePoint.id];
    }, { structural: true });
    setStatus(statusEl, `${point.name} retiré${carried ? ', durée reportée sur le segment précédent' : ''}.`, 'success');
}

function movePoint(index, offset) {
    const route = currentRoute();
    const target = index + offset;
    if (!route || target < 0 || target >= route.points.length) return;
    commit(() => {
        const [item] = route.points.splice(index, 1);
        route.points.splice(target, 0, item);
    }, { structural: true });
    const touched = [target - 1, target, index - 1, index].filter(i => i >= 0 && i < segmentViews.length);
    for (const i of new Set(touched)) flash(segmentViews[i].row);
    setStatus(statusEl, 'Point déplacé. Chaque durée reste attachée à son point de départ : vérifiez les segments surlignés.', 'warning');
}

function duplicateRoute() {
    const route = currentRoute();
    if (!route) return;
    let id = `${route.id}_COPIE`;
    for (let n = 2; state.data.trajets.some(other => other.id === id); n++) id = `${route.id}_COPIE_${n}`;
    commit(() => {
        state.data.trajets.push({ ...structuredClone(route), id, name: `${route.name || route.id} (copie)` });
    });
    setStatus(statusEl, `Trajet ${id} ajouté à l’export. Pour le proposer dans l’app, déclarez-le dans js/routes-config.js.`, 'success');
}

function exportJson() {
    try {
        const document_ = buildMasterRoutesDocument(state.data.points, state.data.trajets);
        downloadMasterRoutesDocument(document_);
        const outOfRange = state.data.trajets.flatMap(route =>
            buildRouteSegments(state.data.points, route).filter(segment => segment.status !== 'ok'));
        const note = outOfRange.length
            ? ` ${outOfRange.length} segment${outOfRange.length > 1 ? 's restent' : ' reste'} hors de la plage `
                + `${ROUTE_SPEED_BOUNDS_KMH.min}–${ROUTE_SPEED_BOUNDS_KMH.max} km/h (tous trajets confondus).`
            : '';
        setStatus(statusEl, 'Export validé : remplacez data/masterRoutes.normalized.json par ce fichier. '
            + `Le brouillon s’effacera de lui-même une fois le fichier à jour.${note}`, outOfRange.length ? 'warning' : 'success');
    } catch (error) {
        setStatus(statusEl, error.message, 'error');
    }
}

// ---------- Rendu ----------

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function iconButton(iconName, label, onClick, extraClass = '') {
    const button = element('button', `icon-btn ${extraClass}`.trim());
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = element('i', `fas ${iconName}`);
    glyph.setAttribute('aria-hidden', 'true');
    button.appendChild(glyph);
    button.addEventListener('click', onClick);
    return button;
}

function inputField(label, field, value, { index, type = 'text', step, placeholder } = {}) {
    const wrap = element('label', 'field');
    const input = element('input');
    input.type = type;
    input.value = value ?? '';
    input.dataset.field = field;
    if (step) input.step = step;
    if (placeholder) input.placeholder = placeholder;
    if (type === 'number') input.inputMode = 'decimal';
    input.addEventListener('change', () => setPointField(index, field, input.value));
    wrap.append(element('span', '', label), input);
    return wrap;
}

function typeField(index, currentType) {
    const wrap = element('label', 'field');
    const select = element('select');
    for (const type of POINT_TYPES) {
        const option = element('option', '', type.label);
        option.value = type.value;
        option.selected = type.value === currentType;
        select.appendChild(option);
    }
    select.addEventListener('change', () => changePointType(index, select.value));
    wrap.append(element('span', '', 'Type'), select);
    return wrap;
}

function fieldGroup(title, fields) {
    const group = element('div', 'field-group');
    const grid = element('div', 'field-grid');
    grid.append(...fields);
    group.append(element('span', 'field-group-title', title), grid);
    return group;
}

function renderDetails(index, point) {
    const details = element('div', 'point-details');
    const type = point.type || 'passage';
    const common = element('div', 'field-grid');
    common.append(
        inputField('Identifiant', 'id', currentRoute().points[index].id, { index }),
        inputField('Nom', 'name', point.name, { index }),
        typeField(index, type),
        inputField('Latitude commune', 'lat', point.lat, { index, type: 'number', step: '0.000001' }),
        inputField('Longitude commune', 'lon', point.lon, { index, type: 'number', step: '0.000001' }),
        inputField('Vmax (km/h)', 'Vmax', point.Vmax, { index, type: 'number', step: '1' }),
        inputField('Altitude (m)', 'altitude', point.altitude, { index, type: 'number', step: '1' })
    );
    details.appendChild(common);

    const groups = element('div', 'field-groups');
    if (type === 'bifurcation') {
        const lines = element('div', 'field-grid');
        lines.append(
            inputField('Code ligne', 'code_ligne', point.code_ligne, { index }),
            inputField('Code ligne 2', 'code_ligne_2', point.code_ligne_2, { index })
        );
        details.appendChild(lines);
        for (const voie of [1, 2]) {
            groups.appendChild(fieldGroup(`Voie ${voie}`, [
                inputField('PK', `PK_V${voie}`, point[`PK_V${voie}`], { index, placeholder: '123,456' }),
                inputField('PK ligne 2', `PK_2_V${voie}`, point[`PK_2_V${voie}`], { index, placeholder: '123,456' }),
                inputField('Latitude', `lat_V${voie}`, point[`lat_V${voie}`], { index, type: 'number', step: '0.000001', placeholder: 'commune' }),
                inputField('Longitude', `lon_V${voie}`, point[`lon_V${voie}`], { index, type: 'number', step: '0.000001', placeholder: 'commune' })
            ]));
        }
    } else {
        const lines = element('div', 'field-grid');
        lines.append(
            inputField('Code ligne', 'code_ligne', point.code_ligne, { index }),
            inputField('PK', 'PK', point.PK, { index, placeholder: '123,456' })
        );
        if (type === 'ouvrage_art') {
            lines.appendChild(inputField('Longueur (m)', 'longueur', point.longueur, { index, type: 'number', step: '1' }));
        }
        details.appendChild(lines);
        if (type === 'ouvrage_art') {
            for (const voie of [1, 2]) {
                groups.appendChild(fieldGroup(`Entrée voie ${voie}`, [
                    inputField('Latitude', `lat_V${voie}`, point[`lat_V${voie}`], { index, type: 'number', step: '0.000001', placeholder: 'commune' }),
                    inputField('Longitude', `lon_V${voie}`, point[`lon_V${voie}`], { index, type: 'number', step: '0.000001', placeholder: 'commune' })
                ]));
            }
        }
    }
    if (groups.children.length) details.appendChild(groups);
    details.appendChild(element('p', 'segment-warning point-drift'));
    return details;
}

function pointMetaText(routePoint, point) {
    const pk = point.type === 'bifurcation'
        ? [point.PK_V1, point.PK_V2].filter(Boolean).join(' / ')
        : point.PK;
    const parts = [POINT_TYPES.find(type => type.value === (point.type || 'passage'))?.label || point.type];
    if (point.code_ligne) parts.push(`ligne ${point.code_ligne}${point.code_ligne_2 ? ` → ${point.code_ligne_2}` : ''}`);
    if (pk) parts.push(`PK ${pk}`);
    return parts.join(' · ');
}

function renderPointRow(routePoint, index, total) {
    const point = state.data.points[routePoint.id] || { name: routePoint.id };
    const row = element('li', `point-row${state.openPointIds.has(routePoint.id) ? ' is-open' : ''}`);
    row.dataset.point = String(index);
    const head = element('div', 'point-head');

    const indexBadge = element('span', 'point-index', String(index + 1));
    const type = point.type || 'passage';
    const chip = element('span', `type-chip ${type}`, POINT_TYPES.find(item => item.value === type)?.glyph || '●');
    chip.title = POINT_TYPES.find(item => item.value === type)?.label || type;

    const title = element('button', 'point-title');
    title.type = 'button';
    title.setAttribute('aria-expanded', String(state.openPointIds.has(routePoint.id)));
    const name = element('span', 'point-name');
    const meta = element('span', 'point-meta');
    title.append(name, meta);
    const toggle = () => {
        const open = !row.classList.contains('is-open');
        row.classList.toggle('is-open', open);
        title.setAttribute('aria-expanded', String(open));
        if (open) state.openPointIds.add(routePoint.id);
        else state.openPointIds.delete(routePoint.id);
    };
    title.addEventListener('click', toggle);

    const actions = element('div', 'point-actions');
    const up = iconButton('fa-arrow-up', 'Monter', () => movePoint(index, -1));
    up.disabled = index === 0;
    const down = iconButton('fa-arrow-down', 'Descendre', () => movePoint(index, 1));
    down.disabled = index === total - 1;
    actions.append(
        iconButton('fa-plus', index === total - 1 ? 'Ajouter un point après le terminus' : 'Insérer un point au milieu du segment suivant', () => insertPointAfter(index)),
        up,
        down,
        iconButton('fa-trash-alt', 'Retirer du trajet', () => deletePoint(index), 'danger'),
        iconButton('fa-chevron-right chevron', 'Détails', toggle)
    );

    head.append(indexBadge, chip, title, actions);
    row.append(head, renderDetails(index, point));
    pointViews[index] = { row, name, meta };
    return row;
}

function renderSegmentRow(index) {
    const row = element('li', 'segment-row');
    row.dataset.segment = String(index);

    const durationWrap = element('div', 'duration-field');
    const input = element('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Durée du segment ${index + 1} en secondes ou m:ss`);
    const hint = element('span', 'duration-hint');
    durationWrap.append(input, hint);

    const commitInput = () => {
        const seconds = parseDurationInput(input.value);
        if (seconds === null) {
            input.setAttribute('aria-invalid', 'true');
            setStatus(statusEl, `Durée illisible : « ${input.value} ». Saisissez des secondes (245) ou m:ss (4:05).`, 'error');
            return false;
        }
        input.removeAttribute('aria-invalid');
        setDuration(index, seconds);
        return true;
    };
    input.addEventListener('change', commitInput);
    input.addEventListener('blur', () => {
        const stored = currentRoute()?.points[index]?.durationToNext;
        if (!input.hasAttribute('aria-invalid') && Number.isFinite(stored)) input.value = String(stored);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (commitInput()) focusDuration(index + (event.shiftKey ? -1 : 1));
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const current = parseDurationInput(input.value) ?? 0;
            const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
            input.value = String(Math.max(0, current + step));
            commitInput();
        }
    });

    const measures = element('div', 'segment-measures');
    const speed = element('div', 'segment-speed');
    const warning = element('div', 'segment-warning');
    row.append(durationWrap, measures, speed, warning);
    segmentViews[index] = { row, input, hint, measures, speed, warning };
    return row;
}

function render() {
    const route = currentRoute();
    pointsList.replaceChildren();
    segmentViews = [];
    pointViews = [];
    if (!route) {
        pointsList.appendChild(element('li', 'empty-state', 'Trajet introuvable dans masterRoutes.'));
        return;
    }
    voiePicker.value = String(currentVoie());
    pointsList.classList.toggle('dir-2', currentVoie() === 2);
    route.points.forEach((routePoint, index) => {
        pointsList.appendChild(renderPointRow(routePoint, index, route.points.length));
        if (index < route.points.length - 1) pointsList.appendChild(renderSegmentRow(index));
    });
    refreshComputed();
}

const km = value => `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
const kmh = value => (Number.isFinite(value) ? `${Math.round(value).toLocaleString('fr-FR')} km/h` : '—');

function statusPill(status) {
    const meta = STATUS_LABELS[status];
    if (!meta) return null;
    const pill = element('span', `status-pill ${status}`);
    const glyph = element('i', `fas ${meta.icon}`);
    glyph.setAttribute('aria-hidden', 'true');
    pill.append(glyph, element('span', '', meta.label));
    return pill;
}

/** Met à jour tout ce qui découle des données, sans reconstruire les champs (le focus est préservé). */
function refreshComputed() {
    const route = currentRoute();
    if (!route) return;
    const voie = currentVoie();
    state.segments = buildRouteSegments(state.data.points, route);

    route.points.forEach((routePoint, index) => {
        const view = pointViews[index];
        const point = state.data.points[routePoint.id];
        if (!view || !point) return;
        view.name.textContent = point.name || routePoint.id;
        view.meta.textContent = pointMetaText(routePoint, point);
        // Entrée la plus proche : pour un long ouvrage, l'entrée V2 est l'autre
        // extrémité et s'éloigne légitimement des coordonnées communes.
        const drift = view.row.querySelector('.point-drift');
        const entries = [1, 2].map(v => [point[`lat_V${v}`], point[`lon_V${v}`]])
            .filter(([lat, lon]) => typeof lat === 'number' && typeof lon === 'number');
        const driftKm = entries.length
            ? Math.min(...entries.map(([lat, lon]) => haversineDistance(point.lat, point.lon, lat, lon)))
            : 0;
        drift.textContent = driftKm > SHARED_COORDINATE_DRIFT_KM
            ? `⚠ Les coordonnées communes sont à ${km(driftKm)} des entrées de voie. Le suivi utilise `
                + 'ces entrées ; les communes ne servent qu’en repli, mais faussent la lecture et la carte.'
            : '';
    });

    for (const segment of state.segments) {
        const view = segmentViews[segment.index];
        if (!view) continue;
        view.row.classList.remove('too-fast', 'too-slow', 'no-duration');
        if (segment.status !== 'ok') view.row.classList.add(segment.status);
        if (document.activeElement !== view.input) view.input.value = String(segment.durationS);
        view.hint.textContent = `${formatDuration(segment.durationS)} min`;

        view.measures.replaceChildren();
        const gps = element('span');
        gps.append('Moteur ', element('b', '', km(segment.distanceKm)));
        view.measures.appendChild(gps);
        const pk = element('span');
        if (segment.pkDistanceKm !== null) {
            pk.append('PK ', element('b', '', km(segment.pkDistanceKm)), ' ',
                element('small', '', `${segment.pkLineCode}${segment.pkLineChange ? ' · changement de ligne' : ''}`));
        } else {
            pk.append('PK ', element('small', '', 'non calculable'));
        }
        view.measures.appendChild(pk);
        view.measures.appendChild(element('span', '', `${segment.fromName} → ${segment.toName}`));

        view.speed.replaceChildren();
        const pill = statusPill(segment.status);
        if (pill) view.speed.appendChild(pill);
        view.speed.appendChild(element('span', 'speed-value', kmh(segment.speedKmh)));

        const warnings = [];
        if (segment.pkDistanceKm !== null && segment.distanceKm > PK_CHECK_MIN_KM
            && segment.pkDistanceKm < segment.distanceKm * PK_SHORTER_THAN_GPS_RATIO) {
            warnings.push(`⚠ Distance PK (${km(segment.pkDistanceKm)}) plus courte que le vol d’oiseau `
                + `(${km(segment.distanceKm)}) : un PK ou une coordonnée de voie ${voie} est à vérifier.`);
        }
        const from = state.data.points[segment.fromId];
        const to = state.data.points[segment.toId];
        if (from?.type === 'bifurcation' && from.code_ligne_2 && to?.code_ligne
            && from.code_ligne_2 !== to.code_ligne && from.code_ligne !== to.code_ligne) {
            warnings.push(`⚠ Ligne 2 « ${from.code_ligne_2} » ≠ ligne du point suivant « ${to.code_ligne} ».`);
        }
        view.warning.textContent = warnings.join(' ');
        view.warning.hidden = warnings.length === 0;
    }

    renderStats();
    renderSpeedStrip();
    applyFilter();
}

function renderStats() {
    const route = currentRoute();
    const summary = summarizeRouteSegments(state.segments);
    const count = summary.anomalies.length;
    const tile = (label, value, sub, extraClass = '') => {
        const node = element('div', `stat ${extraClass}`.trim());
        node.append(element('span', 'stat-label', label), element('span', 'stat-value', value));
        if (sub) node.appendChild(element('span', 'stat-sub', sub));
        return node;
    };
    const anomalyTile = element('button', `stat ${count ? 'has-issue' : 'is-clean'}`);
    anomalyTile.type = 'button';
    anomalyTile.append(
        element('span', 'stat-label', 'Segments hors plage'),
        element('span', 'stat-value', count ? String(count) : 'Aucun'),
        element('span', 'stat-sub', count
            ? 'Cliquer pour passer au suivant'
            : `tout entre ${ROUTE_SPEED_BOUNDS_KMH.min} et ${ROUTE_SPEED_BOUNDS_KMH.max} km/h`)
    );
    anomalyTile.disabled = !count;
    anomalyTile.addEventListener('click', nextAnomaly);
    statsEl.replaceChildren(
        tile('Durée de base', formatDuration(summary.totalS), 'hors arrêts et ΔT'),
        tile('Distance (moteur)', km(summary.totalKm), `${route.points.length} points · ${state.segments.length} segments`),
        tile('Vitesse moyenne', kmh(summary.averageKmh), `${kmh(summary.minKmh)} → ${kmh(summary.maxKmh)}`),
        anomalyTile
    );
}

function renderSpeedStrip() {
    barsEl.replaceChildren();
    const dirClass = currentVoie() === 2 ? ' dir-2' : '';
    for (const segment of state.segments) {
        const bar = element('button', `speed-bar${dirClass} ${segment.status}`);
        bar.type = 'button';
        bar.style.flexGrow = String(Math.max(segment.distanceKm, 0.4));
        const fill = element('span');
        const ratio = Math.min(segment.speedKmh ?? 0, SPEED_STRIP_MAX_KMH) / SPEED_STRIP_MAX_KMH;
        fill.style.height = `${Math.max(ratio * 100, 4)}%`;
        bar.appendChild(fill);
        const label = `${segment.index + 1}. ${segment.fromName} → ${segment.toName} · `
            + `${formatDuration(segment.durationS)} · ${kmh(segment.speedKmh)}`
            + `${STATUS_LABELS[segment.status] ? ` · ${STATUS_LABELS[segment.status].label}` : ''}`;
        bar.title = label;
        bar.setAttribute('aria-label', label);
        bar.addEventListener('click', () => focusSegment(segment.index));
        barsEl.appendChild(bar);
    }
}

function applyFilter() {
    const only = anomaliesOnly.checked;
    const flagged = new Set(state.segments.filter(segment => segment.status !== 'ok').map(segment => segment.index));
    segmentViews.forEach((view, index) => view?.row.classList.toggle('is-filtered-out', only && !flagged.has(index)));
    pointViews.forEach((view, index) => view?.row.classList.toggle(
        'is-filtered-out',
        only && !flagged.has(index) && !flagged.has(index - 1)
    ));
}

function flash(row) {
    if (!row) return;
    row.classList.remove('is-flash');
    void row.offsetWidth;
    row.classList.add('is-flash');
}

function focusDuration(index) {
    const view = segmentViews[index];
    if (!view) return;
    view.input.focus();
    view.input.select();
}

function focusSegment(index, { instant = false } = {}) {
    const view = segmentViews[index];
    if (!view) return;
    if (view.row.classList.contains('is-filtered-out')) {
        anomaliesOnly.checked = false;
        applyFilter();
    }
    const smooth = !instant && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    view.row.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    flash(view.row);
    view.input.focus({ preventScroll: true });
    view.input.select();
}

function nextAnomaly() {
    const flagged = state.segments.filter(segment => segment.status !== 'ok');
    if (!flagged.length) return;
    state.anomalyCursor = (state.anomalyCursor + 1) % flagged.length;
    focusSegment(flagged[state.anomalyCursor].index);
}

function selectRoute(routeKey) {
    state.routeKey = MAIN_ROUTES[routeKey] ? routeKey : Object.keys(MAIN_ROUTES)[0];
    routePicker.value = state.routeKey;
    state.openPointIds.clear();
    state.anomalyCursor = -1;
    shell.setRouteKey(state.routeKey);
    profileLink.href = `route-profile.html?route=${encodeURIComponent(state.routeKey)}`;
    render();
}

// ---------- Initialisation ----------

async function init() {
    for (const [key, config] of Object.entries(MAIN_ROUTES)) {
        const option = element('option', '', config.label);
        option.value = key;
        routePicker.appendChild(option);
    }
    routePicker.addEventListener('change', () => {
        selectRoute(routePicker.value);
        setStatus(statusEl, '');
        window.scrollTo({ top: 0 });
    });
    voiePicker.addEventListener('change', () => {
        const route = currentRoute();
        if (!route) return;
        commit(() => { route.voie = Number(voiePicker.value); }, { structural: true });
        setStatus(statusEl, `Voie ${voiePicker.value} : les distances utilisent désormais les entrées de cette voie.`, 'success');
    });
    anomaliesOnly.addEventListener('change', applyFilter);
    undoButton.addEventListener('click', undo);
    document.getElementById('add-point-btn').addEventListener('click', () => {
        const route = currentRoute();
        if (route) insertPointAfter(route.points.length - 1);
    });
    document.getElementById('duplicate-route-btn').addEventListener('click', duplicateRoute);
    document.getElementById('export-btn').addEventListener('click', exportJson);
    document.addEventListener('keydown', event => {
        const editing = event.target.closest?.('input, select, textarea');
        if (!editing && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            undo();
        }
    });
    shell.onExternalDraftChange(() => showReloadNotice(
        'Le brouillon a été modifié dans un autre onglet d’éditeur. Rechargez pour repartir de sa dernière version.'
    ));

    const loaded = await loadEditableMasterRoutes();
    Object.assign(state, { data: loaded.data, fileData: loaded.fileData, storage: loaded.storage });
    updateDraftBanner(loaded.draftSavedAt);
    if (!loaded.storage) {
        setStatus(statusEl, 'Stockage local indisponible : les modifications seront perdues en quittant la page, exportez avant.', 'warning');
    }

    // Lu avant selectRoute, qui retire « seg » de l'URL.
    const segment = Number.parseInt(readQueryParam('seg') ?? '', 10);
    selectRoute(readQueryParam('route'));
    // Rendu synchrone : pas de requestAnimationFrame, suspendu dans un onglet ouvert en arrière-plan.
    if (Number.isInteger(segment)) focusSegment(segment, { instant: true });
}

init().catch(error => setStatus(statusEl, `Erreur de chargement : ${error.message}`, 'error'));
