const state = {
    routes: [],
    selectedRouteId: '',
    dirty: false
};

const NUMBER_FIELDS = new Set(['lat', 'lon', 'baseDurationToNext', 'segmentLength']);

const routePicker = document.getElementById('route-picker');
const tableBody = document.querySelector('#points-table tbody');
const summaryPoints = document.getElementById('summary-points');
const summaryDuration = document.getElementById('summary-duration');
const summaryDistance = document.getElementById('summary-distance');
const messages = document.getElementById('editor-messages');
const dirtyIndicator = document.getElementById('dirty-indicator');

document.getElementById('add-point-btn')?.addEventListener('click', () => addPointAtEnd());
document.getElementById('duplicate-route-btn')?.addEventListener('click', () => duplicateRoute());
document.getElementById('export-btn')?.addEventListener('click', () => exportJson());
routePicker?.addEventListener('change', () => {
    state.selectedRouteId = routePicker.value;
    renderTable();
    updateSummary();
    clearMessages();
});

init();

async function init() {
    try {
        const masterRes = await fetch('data/masterRoutes.json');
        if (!masterRes.ok) throw new Error(`HTTP ${masterRes.status}`);

        const masterData = await masterRes.json();

        state.routes = masterData.masterRoutes || [];
        state.selectedRouteId = state.routes[0]?.id || '';
        renderRoutePicker();
        renderTable();
        updateSummary();
    } catch (e) {
        showMessage(`Erreur de chargement des master routes : ${e.message}`, 'error');
    }
}

function renderRoutePicker() {
    if (!routePicker) return;
    routePicker.innerHTML = '';
    state.routes.forEach(route => {
        const opt = document.createElement('option');
        opt.value = route.id;
        opt.textContent = `${route.name || route.id} (${route.id})`;
        routePicker.appendChild(opt);
    });
    routePicker.value = state.selectedRouteId;
}

function getSelectedRoute() {
    return state.routes.find(r => r.id === state.selectedRouteId) || null;
}

function renderTable() {
    if (!tableBody) return;
    const route = getSelectedRoute();
    tableBody.innerHTML = '';
    if (!route) return;

    (route.points || []).forEach((point, idx) => {
        const tr = document.createElement('tr');

        tr.appendChild(cellText(idx + 1));
        tr.appendChild(cellInput('text', point.id, val => updatePoint(idx, 'id', val)));
        tr.appendChild(cellInput('text', point.name, val => updatePoint(idx, 'name', val)));
        tr.appendChild(cellInput('number', point.lat, val => updatePoint(idx, 'lat', val), '0.00001'));
        tr.appendChild(cellInput('number', point.lon, val => updatePoint(idx, 'lon', val), '0.00001'));
        tr.appendChild(cellInput('number', point.baseDurationToNext, val => updatePoint(idx, 'baseDurationToNext', val), '1'));
        tr.appendChild(cellInput('number', point.segmentLength, val => updatePoint(idx, 'segmentLength', val), '1'));

        const actionsTd = document.createElement('td');
        actionsTd.className = 'actions-cell';

        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.title = 'Monter';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => movePoint(idx, idx - 1));

        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.title = 'Descendre';
        downBtn.disabled = idx === (route.points.length - 1);
        downBtn.addEventListener('click', () => movePoint(idx, idx + 1));

        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.title = 'Supprimer';
        delBtn.addEventListener('click', () => {
            if (confirm(`Supprimer le point ${point.name || point.id} ?`)) {
                deletePoint(idx);
            }
        });

        actionsTd.appendChild(upBtn);
        actionsTd.appendChild(downBtn);
        actionsTd.appendChild(delBtn);

        tr.appendChild(actionsTd);
        tableBody.appendChild(tr);
    });
}

function cellText(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

function cellInput(type, value, onChange, step = null) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    if (step) input.step = step;
    if (type === 'number') {
        input.inputMode = 'decimal';
    }
    input.addEventListener('change', (e) => {
        onChange(e.target.value);
    });
    td.appendChild(input);
    return td;
}

function cellCheckbox(checked, onChange) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', (e) => onChange(e.target.checked));
    td.appendChild(input);
    return td;
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

    route.points[index] = {
        ...route.points[index],
        [field]: value
    };
    markDirty();
    updateSummary();
}

function addPointAtEnd() {
    const route = getSelectedRoute();
    if (!route) return;
    const now = Date.now();
    route.points.push({
        id: `NEW_${now}`,
        name: 'Nouveau point',
        lat: 0,
        lon: 0,
        baseDurationToNext: 0,
        segmentLength: 0
    });
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
    state.selectedRouteId = newId;
    renderRoutePicker();
    renderTable();
    updateSummary();
    markDirty();
}

function exportJson() {
    const data = { masterRoutes: state.routes };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'masterRoutes.updated.json';
    a.click();
    URL.revokeObjectURL(url);
    showMessage('Export réalisé. Remplacez data/masterRoutes.json avec ce fichier si besoin.', 'success');
    clearDirty();
}

function updateSummary() {
    const route = getSelectedRoute();
    if (!route) return;
    const points = route.points || [];
    const totalDuration = points.reduce((sum, p) => sum + Number(p.baseDurationToNext || 0), 0);
    const totalDistanceKm = points.reduce((sum, p) => sum + Number(p.segmentLength || 0), 0) / 1000;

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

function formatMinutes(totalSeconds) {
    const minutes = Math.round(Number(totalSeconds || 0) / 60);
    const hh = Math.floor(minutes / 60);
    const mm = Math.abs(minutes % 60);
    const hhStr = hh.toString().padStart(2, '0');
    const mmStr = mm.toString().padStart(2, '0');
    return `${hhStr}:${mmStr}`;
}
