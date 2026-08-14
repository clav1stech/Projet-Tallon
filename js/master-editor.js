import { MAIN_ROUTES } from './routes-config.js';
import {
    buildMasterRoutesDocument,
    downloadMasterRoutesDocument,
    loadMasterRoutes
} from './master-routes-data.js';
import { getVoieForRoute } from './utils.js';

const state = {
    routes: [],        // Tous les trajets chargés depuis le JSON
    globalPoints: {},
    selectedRouteKey: '',  // Clé dans MAIN_ROUTES (ex: 'PARIS_TO_MACON')
    dirty: false
};

const NUMBER_FIELDS = new Set(['lat', 'lon', 'lat_V1', 'lon_V1', 'lat_V2', 'lon_V2', 'durationToNext', 'Vmax', 'altitude', 'longueur']);

const GLOBAL_FIELDS = new Set([
    'name', 'lat', 'lon', 'type',
    // non-bifurcation
    'code_ligne', 'PK', 'longueur',
    // points directionnels : coordonnées différentes par voie
    'code_ligne_2', 'PK_V1', 'PK_2_V1', 'PK_V2', 'PK_2_V2',
    'lat_V1', 'lon_V1', 'lat_V2', 'lon_V2',
    // commun
    'Vmax', 'altitude',
]);

const POINT_TYPES = [
    { value: 'passage',          label: 'Passage' },
    { value: 'gare',             label: 'Gare' },
    { value: 'ouvrage_art',      label: "Ouvrage d'art" },
    { value: 'bifurcation',      label: 'Bifurcation' },
    { value: 'poste_aiguillage', label: 'Poste d\'aiguillage (PRS/SEI/PRCI)' },
];

const routePicker = document.getElementById('route-picker');
const voiePicker = document.getElementById('voie-picker');
const pointsList = document.getElementById('points-list');
const summaryPoints = document.getElementById('summary-points');
const summaryDuration = document.getElementById('summary-duration');
const summaryDistance = document.getElementById('summary-distance');
const messages = document.getElementById('editor-messages');
const dirtyIndicator = document.getElementById('dirty-indicator');

document.getElementById('add-point-btn')?.addEventListener('click', () => addPointAtEnd());
document.getElementById('duplicate-route-btn')?.addEventListener('click', () => duplicateRoute());
document.getElementById('export-btn')?.addEventListener('click', () => exportJson());
routePicker?.addEventListener('change', () => {
    state.selectedRouteKey = routePicker.value;
    syncVoiePicker();
    renderTable();
    updateSummary();
    clearMessages();
});
voiePicker?.addEventListener('change', () => {
    const route = getSelectedRoute();
    if (route) {
        route.voie = Number(voiePicker.value);
        markDirty();
        renderTable();
        updateSummary();
    }
});

init();

async function init() {
    try {
        const masterData = await loadMasterRoutes();

        state.globalPoints = masterData.points || {};
        state.routes = masterData.trajets || [];
        state.selectedRouteKey = Object.keys(MAIN_ROUTES)[0] || '';
        renderRoutePicker();
        syncVoiePicker();
        renderTable();
        updateSummary();
    } catch (e) {
        showMessage(`Erreur de chargement des master routes : ${e.message}`, 'error');
    }
}

function renderRoutePicker() {
    if (!routePicker) return;
    routePicker.innerHTML = '';
    // Piloté par MAIN_ROUTES — source unique, même liste que l'app
    for (const [key, cfg] of Object.entries(MAIN_ROUTES)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = cfg.label;
        routePicker.appendChild(opt);
    }
    routePicker.value = state.selectedRouteKey;
}

function getSelectedRoute() {
    const cfg = MAIN_ROUTES[state.selectedRouteKey];
    if (!cfg) return null;
    return state.routes.find(r => r.id === cfg.masterRouteId) || null;
}

function renderTable() {
    if (!pointsList) return;
    const route = getSelectedRoute();
    pointsList.innerHTML = '';
    if (!route) return;

    const points = route.points || [];
    points.forEach((routePt, idx) => {
        const point = { ...state.globalPoints[routePt.id], ...routePt };
        // --- Point card ---
        const card = document.createElement('div');
        card.className = 'point-card';

        const cardHeader = document.createElement('div');
        cardHeader.className = 'point-card-header';

        const indexBadge = document.createElement('span');
        indexBadge.className = 'point-index-badge';
        indexBadge.textContent = idx + 1;
        cardHeader.appendChild(indexBadge);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'point-card-actions';

        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.title = 'Monter';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => movePoint(idx, idx - 1));

        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.title = 'Descendre';
        downBtn.disabled = idx === (points.length - 1);
        downBtn.addEventListener('click', () => movePoint(idx, idx + 1));

        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.title = 'Supprimer';
        delBtn.addEventListener('click', () => {
            if (confirm(`Supprimer le point ${point.name || point.id} ?`)) {
                deletePoint(idx);
            }
        });

        actionsDiv.appendChild(upBtn);
        actionsDiv.appendChild(downBtn);
        actionsDiv.appendChild(delBtn);
        cardHeader.appendChild(actionsDiv);
        card.appendChild(cardHeader);

        const cardFields = document.createElement('div');
        cardFields.className = 'point-card-fields';

        cardFields.appendChild(labeledInput('ID', 'text', point.id, val => updatePoint(idx, 'id', val)));
        cardFields.appendChild(labeledInput('Nom', 'text', point.name, val => updatePoint(idx, 'name', val)));
        cardFields.appendChild(labeledInput('Lat', 'number', point.lat, val => updatePoint(idx, 'lat', val), '0.00001'));
        cardFields.appendChild(labeledInput('Lon', 'number', point.lon, val => updatePoint(idx, 'lon', val), '0.00001'));
        cardFields.appendChild(labeledTypeSelect(point.type || 'passage', newType => changePointType(idx, newType)));
        renderTypeFields(cardFields, point, idx);
        cardFields.appendChild(labeledInput('Vmax (km/h)', 'number', point.Vmax, val => updatePoint(idx, 'Vmax', val), '1'));
        cardFields.appendChild(labeledInput('Altitude (m)', 'number', point.altitude, val => updatePoint(idx, 'altitude', val), '1'));

        card.appendChild(cardFields);
        pointsList.appendChild(card);

        // --- Segment connector (not after last point) ---
        if (idx < points.length - 1) {
            const seg = document.createElement('div');
            seg.className = 'segment-connector';

            const nextRoutePt = points[idx + 1];
            const nextPoint = { ...state.globalPoints[nextRoutePt.id], ...nextRoutePt };
            const voie = getVoieForRoute(route) || 1;
            const pkCalc = calcSegmentFromPK(point, nextPoint, voie);

            // Warn if code_ligne_2 of this point doesn't match code_ligne of next (when both have data)
            const normA = normalizeForPK(point, voie);
            const normB = normalizeForPK(nextPoint, voie);
            const hasLineChangeMismatch = normA.code_ligne_2 && normB.code_ligne
                && normA.code_ligne_2 !== normB.code_ligne
                && normA.code_ligne !== normB.code_ligne;

            const duration = Number(point.durationToNext || 0);
            // Distance : PK si disponible, sinon Haversine (lecture seule — non persisté)
            const distance = pkCalc !== null ? pkCalc.distance : Math.round(haversineMeters(point.lat, point.lon, nextPoint.lat, nextPoint.lon));
            const speedKmh = duration > 0 ? (distance / 1000) / (duration / 3600) : 0;
            const gpsDistance = haversineMeters(point.lat, point.lon, nextPoint.lat, nextPoint.lon);

            const segFields = document.createElement('div');
            segFields.className = 'segment-fields';

            const durationWrap = document.createElement('div');
            durationWrap.className = 'segment-field';
            const durationLabel = document.createElement('span');
            durationLabel.className = 'segment-label';
            durationLabel.textContent = 'Durée (s)';
            const durationInput = document.createElement('input');
            durationInput.type = 'number';
            durationInput.value = duration;
            durationInput.step = '1';
            durationInput.addEventListener('change', e => {
                updatePoint(idx, 'durationToNext', e.target.value);
                renderTable();
            });
            durationWrap.appendChild(durationLabel);
            durationWrap.appendChild(durationInput);

            const distanceWrap = document.createElement('div');
            distanceWrap.className = 'segment-field';
            const distanceLabel = document.createElement('span');
            distanceLabel.className = 'segment-label';
            distanceLabel.textContent = 'Distance (m)';
            if (pkCalc !== null) {
                const distanceReadonly = document.createElement('span');
                distanceReadonly.className = 'segment-speed-value';
                const lineTag = pkCalc.isLineChange
                    ? `<small style="color:#FF9800;font-weight:600">⚡ ${pkCalc.lineCode} (chgt ligne)</small>`
                    : `<small style="color:#4CAF50;font-weight:600">⚡ ${pkCalc.lineCode}</small>`;
                distanceReadonly.innerHTML = `${pkCalc.distance} ${lineTag}`;
                distanceWrap.appendChild(distanceLabel);
                distanceWrap.appendChild(distanceReadonly);
            } else {
                // Pas de PK calculable : affichage Haversine en lecture seule (non persisté)
                const distanceReadonly = document.createElement('span');
                distanceReadonly.className = 'segment-speed-value';
                distanceReadonly.innerHTML = `${distance} <small style="color:#9E9E9E">GPS</small>`;
                distanceWrap.appendChild(distanceLabel);
                distanceWrap.appendChild(distanceReadonly);
            }

            const speedWrap = document.createElement('div');
            speedWrap.className = 'segment-field segment-speed';
            const speedLabel = document.createElement('span');
            speedLabel.className = 'segment-label';
            speedLabel.textContent = 'Vitesse moy.';
            const speedValue = document.createElement('span');
            speedValue.className = 'segment-speed-value';
            speedValue.textContent = `${speedKmh.toFixed(1)} km/h`;
            speedWrap.appendChild(speedLabel);
            speedWrap.appendChild(speedValue);

            const gpsWrap = document.createElement('div');
            gpsWrap.className = 'segment-field segment-speed';
            const gpsLabel = document.createElement('span');
            gpsLabel.className = 'segment-label';
            gpsLabel.textContent = 'Dist. GPS';
            const gpsValue = document.createElement('span');
            gpsValue.className = 'segment-speed-value';
            const gpsFormatted = gpsDistance >= 1000
                ? `${(gpsDistance / 1000).toFixed(2)} km`
                : `${Math.round(gpsDistance)} m`;
            const ratio = distance > 0 ? (gpsDistance / distance).toFixed(2) : '–';
            gpsValue.textContent = `${gpsFormatted} (×${ratio})`;
            gpsWrap.appendChild(gpsLabel);
            gpsWrap.appendChild(gpsValue);

            segFields.appendChild(durationWrap);
            segFields.appendChild(distanceWrap);
            segFields.appendChild(gpsWrap);
            segFields.appendChild(speedWrap);
            seg.appendChild(segFields);

            if (hasLineChangeMismatch) {
                const warn = document.createElement('div');
                warn.style.cssText = 'color:#e53935;font-size:0.8em;padding:2px 8px;';
                warn.textContent = `⚠ code_ligne_2 "${normA.code_ligne_2}" ≠ code_ligne suivant "${normB.code_ligne}"`;
                seg.appendChild(warn);
            }

            pointsList.appendChild(seg);
        }
    });
}

function labeledTypeSelect(currentType, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'point-field point-field--type';
    const lbl = document.createElement('span');
    lbl.className = 'point-field-label';
    lbl.textContent = 'Type';
    const select = document.createElement('select');
    select.className = 'point-type-select';
    for (const t of POINT_TYPES) {
        const opt = document.createElement('option');
        opt.value = t.value;
        opt.textContent = t.label;
        if (t.value === currentType) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener('change', e => onChange(e.target.value));
    wrap.appendChild(lbl);
    wrap.appendChild(select);
    return wrap;
}

function renderTypeFields(container, point, idx) {
    const type = point.type || 'passage';

    if (type === 'bifurcation') {
        // Lignes communes aux deux voies
        container.appendChild(labeledInput('Code ligne', 'text', point.code_ligne, val => { updatePoint(idx, 'code_ligne', val); renderTable(); }));
        container.appendChild(labeledInput('Code ligne 2', 'text', point.code_ligne_2, val => { updatePoint(idx, 'code_ligne_2', val); renderTable(); }));
        // PK et coordonnées différents par voie
        const groups = [
            { label: 'Voie 1', pkFld: 'PK_V1', pk2Fld: 'PK_2_V1', latFld: 'lat_V1', lonFld: 'lon_V1' },
            { label: 'Voie 2', pkFld: 'PK_V2', pk2Fld: 'PK_2_V2', latFld: 'lat_V2', lonFld: 'lon_V2' },
        ];
        for (const g of groups) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'point-field-group';
            const title = document.createElement('span');
            title.className = 'point-field-group-title';
            title.textContent = g.label;
            groupDiv.appendChild(title);
            groupDiv.appendChild(labeledInput('PK', 'text', point[g.pkFld], val => { updatePoint(idx, g.pkFld, val); renderTable(); }));
            groupDiv.appendChild(labeledInput('PK 2', 'text', point[g.pk2Fld], val => { updatePoint(idx, g.pk2Fld, val); renderTable(); }));
            groupDiv.appendChild(labeledInput('Lat', 'number', point[g.latFld], val => { updatePoint(idx, g.latFld, val); }, '0.00001'));
            groupDiv.appendChild(labeledInput('Lon', 'number', point[g.lonFld], val => { updatePoint(idx, g.lonFld, val); }, '0.00001'));
            container.appendChild(groupDiv);
        }
        return;
    }

    container.appendChild(labeledInput('Code ligne', 'text', point.code_ligne, val => { updatePoint(idx, 'code_ligne', val); renderTable(); }));
    container.appendChild(labeledInput('PK', 'text', point.PK, val => { updatePoint(idx, 'PK', val); renderTable(); }));
    if (type === 'ouvrage_art') {
        container.appendChild(labeledInput('Longueur (m)', 'number', point.longueur, val => updatePoint(idx, 'longueur', val), '1'));
        for (const voie of [1, 2]) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'point-field-group';
            const title = document.createElement('span');
            title.className = 'point-field-group-title';
            title.textContent = `Entrée voie ${voie}`;
            groupDiv.appendChild(title);
            groupDiv.appendChild(labeledInput(
                'Lat', 'number', point[`lat_V${voie}`],
                val => updatePoint(idx, `lat_V${voie}`, val), '0.00001'
            ));
            groupDiv.appendChild(labeledInput(
                'Lon', 'number', point[`lon_V${voie}`],
                val => updatePoint(idx, `lon_V${voie}`, val), '0.00001'
            ));
            container.appendChild(groupDiv);
        }
    }
}

/**
 * Change le type d'un point et migre ses champs PK/code_ligne en conséquence.
 * - → bifurcation : copie code_ligne → V1+V2, PK → V1+V2, idem pour _2
 * - bifurcation → autre : copie V1 → code_ligne/PK, supprime les champs V2
 */
function changePointType(idx, newType) {
    const route = getSelectedRoute();
    if (!route) return;
    const ptId = route.points[idx].id;
    const gp = state.globalPoints[ptId];
    if (!gp) return;

    const oldType = gp.type || 'passage';
    if (oldType === newType) return;

    if (newType === 'bifurcation') {
        // code_ligne reste, PK → PK_V1 = PK_V2 (à affiner manuellement), idem pour _2
        const pk  = gp.PK  ?? '';
        delete gp.PK; delete gp.longueur;
        gp.code_ligne_2 = '';
        gp.PK_V1   = pk;  gp.PK_V2   = pk;
        gp.PK_2_V1 = '';  gp.PK_2_V2 = '';
        // Initialiser lat/lon par voie avec la valeur commune (à affiner manuellement)
        gp.lat_V1 = gp.lat ?? null; gp.lon_V1 = gp.lon ?? null;
        gp.lat_V2 = gp.lat ?? null; gp.lon_V2 = gp.lon ?? null;
    } else if (oldType === 'bifurcation') {
        // Garde PK_V1 et lat_V1/lon_V1 comme valeurs principales
        const pk = gp.PK_V1 ?? '';
        if (gp.lat_V1 != null) { gp.lat = gp.lat_V1; gp.lon = gp.lon_V1; }
        delete gp.code_ligne_2;
        delete gp.PK_V1; delete gp.PK_V2;
        delete gp.PK_2_V1; delete gp.PK_2_V2;
        delete gp.lat_V1; delete gp.lon_V1;
        delete gp.lat_V2; delete gp.lon_V2;
        gp.PK     = pk;
        gp.longueur = null;
    } else if (oldType === 'ouvrage_art' && newType !== 'ouvrage_art') {
        gp.longueur = null;
        delete gp.lat_V1; delete gp.lon_V1;
        delete gp.lat_V2; delete gp.lon_V2;
    }

    gp.type = newType;
    markDirty();
    renderTable();
    updateSummary();
}

function labeledInput(label, type, value, onChange, step = null) {
    const wrap = document.createElement('div');
    wrap.className = 'point-field';
    const lbl = document.createElement('span');
    lbl.className = 'point-field-label';
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    if (step) input.step = step;
    if (type === 'number') input.inputMode = 'decimal';
    input.addEventListener('change', e => onChange(e.target.value));
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return wrap;
}

function updatePoint(index, field, rawValue) {
    const route = getSelectedRoute();
    if (!route) return;

    let value = rawValue;
    if (NUMBER_FIELDS.has(field)) {
        value = Number(rawValue);
        if (!Number.isFinite(value)) {
            showMessage(`Valeur numérique invalide pour ${field}`, 'error');
            renderTable();
            return;
        }
    }

    const ptId = route.points[index].id;

    if (field === 'id') {
        // Cascade : renommer la clé dans globalPoints puis mettre à jour tous les points de toutes les routes
        if (state.globalPoints[ptId]) {
            state.globalPoints[value] = state.globalPoints[ptId];
            delete state.globalPoints[ptId];
        }
        for (const r of state.routes) {
            for (const pt of r.points || []) {
                if (pt.id === ptId) pt.id = value;
            }
        }
    } else if (GLOBAL_FIELDS.has(field)) {
        if (!state.globalPoints[ptId]) state.globalPoints[ptId] = {};
        state.globalPoints[ptId][field] = value;
    } else {
        route.points[index][field] = value;
    }

    markDirty();
    updateSummary();
}

function addPointAtEnd() {
    const route = getSelectedRoute();
    if (!route) return;
    const newId = `NEW_${Date.now()}`;
    state.globalPoints[newId] = {
        name: 'Nouveau point',
        lat: 0,
        lon: 0,
        type: 'passage',
        code_ligne: '',
        PK: '',
        longueur: null,
        Vmax: null,
        altitude: null
    };
    route.points.push({ id: newId, durationToNext: 0 });
    markDirty();
    renderTable();
    updateSummary();
}

function deletePoint(index) {
    const route = getSelectedRoute();
    if (!route) return;
    route.points.splice(index, 1);
    markDirty();
    renderTable();
    updateSummary();
}

function movePoint(fromIdx, toIdx) {
    const route = getSelectedRoute();
    if (!route) return;
    if (toIdx < 0 || toIdx >= route.points.length) return;
    const [item] = route.points.splice(fromIdx, 1);
    route.points.splice(toIdx, 0, item);
    markDirty();
    renderTable();
    updateSummary();
}

function duplicateRoute() {
    const route = getSelectedRoute();
    if (!route) return;
    const copy = JSON.parse(JSON.stringify(route));
    const newId = `${route.id}_COPY`;
    copy.id = newId;
    copy.name = `${route.name || route.id} (copie)`;
    state.routes.push(copy);
    markDirty();
    showMessage(`Trajet "${newId}" créé dans l'export JSON. Pour l'ajouter au sélecteur, ajoutez-le dans js/routes-config.js.`, 'info');
}

function exportJson() {
    try {
        const data = buildMasterRoutesDocument(state.globalPoints, state.routes);
        downloadMasterRoutesDocument(data);
        showMessage('Export validé et réalisé. Remplacez data/masterRoutes.normalized.json avec ce fichier pour mettre à jour l\'app et l\'éditeur.', 'success');
        clearDirty();
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

function syncVoiePicker() {
    if (!voiePicker) return;
    const route = getSelectedRoute();
    voiePicker.value = String(getVoieForRoute(route) || 1);
}

function updateSummary() {
    const route = getSelectedRoute();
    if (!route) return;
    const points = route.points || [];
    // Le dernier point est le terminus : son durationToNext est ignoré par buildEffectiveRoute
    const totalDuration = points.slice(0, -1).reduce((sum, p) => sum + Number(p.durationToNext || 0), 0);

    // Distance totale calculée par Haversine (non persistée)
    let totalDistanceKm = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = { ...state.globalPoints[points[i].id], ...points[i] };
        const b = { ...state.globalPoints[points[i + 1].id], ...points[i + 1] };
        if (typeof a.lat === 'number' && typeof b.lat === 'number') {
            totalDistanceKm += haversineMeters(a.lat, a.lon, b.lat, b.lon) / 1000;
        }
    }

    if (summaryPoints) summaryPoints.textContent = points.length.toString();
    if (summaryDuration) summaryDuration.textContent = formatMinutes(totalDuration);
    if (summaryDistance) summaryDistance.textContent = `${totalDistanceKm.toFixed(1)} km`;
}

function markDirty() {
    state.dirty = true;
    if (dirtyIndicator) dirtyIndicator.style.display = 'inline-flex';
}

function clearDirty() {
    state.dirty = false;
    if (dirtyIndicator) dirtyIndicator.style.display = 'none';
}

function showMessage(text, type = 'info') {
    if (!messages) return;
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    messages.innerHTML = '';
    messages.appendChild(div);
}

function clearMessages() {
    if (messages) messages.innerHTML = '';
}

/**
 * Parse un PK SNCF en mètres.
 * Formats supportés : "123+456" → 123456 m, "123.456" / "123,456" → 123456 m, nombre seul → valeur brute
 */
function parsePK(pk) {
    if (!pk && pk !== 0) return null;
    const str = String(pk).trim();
    if (str === '') return null;
    const plusMatch = str.match(/^(\d+)\+(\d{3})$/);
    if (plusMatch) return parseInt(plusMatch[1]) * 1000 + parseInt(plusMatch[2]);
    const dotMatch = str.match(/^(\d+)[.,](\d{3})$/);
    if (dotMatch) return parseInt(dotMatch[1]) * 1000 + parseInt(dotMatch[2]);
    const num = parseFloat(str.replace(',', '.'));
    return isNaN(num) ? null : Math.round(num);
}

/**
 * Calcule la longueur du segment entre deux points en mètres à partir de leurs PK.
 * Priorité : code_ligne_2[A] = code_ligne[B] (changement de ligne), puis autres combinaisons.
 * Retourne { distance, lineCode, isLineChange } ou null.
 */
/**
 * Normalise un point v2 en forme plate {code_ligne, PK, code_ligne_2, PK_2}
 * pour le calcul de segment. Pour les bifurcations, utilise les valeurs V1.
 */
function normalizeForPK(point, voie = 1) {
    if (point.type === 'bifurcation') {
        const cl2 = point.code_ligne_2 ?? '';
        const hasLineChange = cl2 && cl2 !== (point.code_ligne ?? '');
        const pkField   = voie === 2 ? 'PK_V2'   : 'PK_V1';
        const pk2Field  = voie === 2 ? 'PK_2_V2' : 'PK_2_V1';
        return {
            code_ligne:   point.code_ligne ?? '',
            PK:           point[pkField]   ?? '',
            code_ligne_2: hasLineChange ? cl2 : '',
            PK_2:         hasLineChange ? (point[pk2Field] ?? '') : '',
        };
    }
    return {
        code_ligne:   point.code_ligne ?? '',
        PK:           point.PK         ?? '',
        code_ligne_2: '',
        PK_2:         '',
    };
}

function calcSegmentFromPK(pointA, pointB, voie = 1) {
    const a = normalizeForPK(pointA, voie);
    const b = normalizeForPK(pointB, voie);

    const aEntries = [
        { code: a.code_ligne,   pk: parsePK(a.PK),   slot: 1 },
        { code: a.code_ligne_2, pk: parsePK(a.PK_2), slot: 2 }
    ].filter(x => x.code && x.pk !== null);

    const bEntries = [
        { code: b.code_ligne,   pk: parsePK(b.PK),   slot: 1 },
        { code: b.code_ligne_2, pk: parsePK(b.PK_2), slot: 2 }
    ].filter(x => x.code && x.pk !== null);

    // Priorité au changement de ligne : slot 2 de A → slot 1 de B
    for (const a of aEntries.filter(x => x.slot === 2)) {
        for (const b of bEntries.filter(x => x.slot === 1)) {
            if (a.code === b.code) {
                return { distance: Math.abs(b.pk - a.pk), lineCode: a.code, isLineChange: true };
            }
        }
    }
    // Même ligne : slot 1 de A → slot 1 de B
    for (const a of aEntries.filter(x => x.slot === 1)) {
        for (const b of bEntries.filter(x => x.slot === 1)) {
            if (a.code === b.code) {
                return { distance: Math.abs(b.pk - a.pk), lineCode: a.code, isLineChange: false };
            }
        }
    }
    // Fallback : toutes les autres combinaisons
    for (const a of aEntries) {
        for (const b of bEntries) {
            if (a.code === b.code) {
                return { distance: Math.abs(b.pk - a.pk), lineCode: a.code, isLineChange: a.slot !== b.slot };
            }
        }
    }
    return null;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatMinutes(totalSeconds) {
    const minutes = Math.round(Number(totalSeconds || 0) / 60);
    const hh = Math.floor(minutes / 60);
    const mm = Math.abs(minutes % 60);
    const hhStr = hh.toString().padStart(2, '0');
    const mmStr = mm.toString().padStart(2, '0');
    return `${hhStr}:${mmStr}`;
}
