// js/ui.js
import { STATE, saveSettings } from './state.js';
import { formatTime, timeStringToDate } from './utils.js';

// Configuration des routes principales (départ Paris)
export const MAIN_ROUTES = {
    PARIS_TO_LPD: {
        label: 'Paris → Lyon-Part-Dieu',
        masterRouteId: 'PAR_LPD_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'LYON_PART_DIEU',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' }
        ]
    },
    PARIS_TO_MACON: {
        label: 'Paris → Mâcon',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'MACON_LOCHE',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    PARIS_TO_MARSEILLE: {
        label: 'Paris → Marseille',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'MARSEILLE_ST_CHARLES',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'LYON_ST_EX', label: 'Lyon-Saint-Exupéry TGV' },
            { id: 'VALENCE_TGV', label: 'Valence TGV' },
            { id: 'AVIGNON_TGV', label: 'Avignon TGV' },
            { id: 'AIX_TGV', label: 'Aix-en-Provence TGV' }
        ]
    },
    LPD_TO_PARIS: {
        label: 'Lyon-Part-Dieu → Paris',
        masterRouteId: 'PAR_LPD_SUD',
        startPointId: 'LYON_PART_DIEU',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    MACON_TO_PARIS: {
        label: 'Mâcon → Paris',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'MACON_LOCHE',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    MARSEILLE_TO_PARIS: {
        label: 'Marseille → Paris',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'MARSEILLE_ST_CHARLES',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'AIX_TGV', label: 'Aix-en-Provence TGV' },
            { id: 'AVIGNON_TGV', label: 'Avignon TGV' },
            { id: 'VALENCE_TGV', label: 'Valence TGV' },
            { id: 'LYON_ST_EX', label: 'Lyon-Saint-Exupéry TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    }
};

// -- FONCTIONS UI PRINCIPALES --

export function populateTrajetDropdown() {
    const trajetSelect = document.getElementById('routeSelect');
    if (!trajetSelect) return;

    trajetSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Choisir la destination --';
    trajetSelect.appendChild(placeholder);

    Object.entries(MAIN_ROUTES).forEach(([key, route]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = route.label;
        trajetSelect.appendChild(opt);
    });

    trajetSelect.value = STATE.selectedMainRouteKey || '';
}

// Affiche les cases à cocher des arrêts intermédiaires pour la route sélectionnée
export function renderStopCheckboxes(mainRouteKey, selectedStopIds = [], onChange = null) {
    const container = document.getElementById('stopCheckboxes');
    const wrapper = document.getElementById('stopsRow');
    if (!container || !wrapper) return;

    container.innerHTML = '';
    const config = MAIN_ROUTES[mainRouteKey];

    if (!config) {
        wrapper.style.display = 'flex';
        container.innerHTML = '<span class="hint">Sélectionnez une destination pour afficher les arrêts.</span>';
        return;
    }

    wrapper.style.display = 'flex';

    config.stopOptions.forEach(stop => {
        const labelEl = document.createElement('label');
        labelEl.className = 'checkbox-pill';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = stop.id;
        input.checked = selectedStopIds.includes(stop.id);

        input.addEventListener('change', () => {
            const values = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
            if (typeof onChange === 'function') {
                onChange(values);
            }
        });

        const span = document.createElement('span');
        span.textContent = stop.label;

        labelEl.appendChild(input);
        labelEl.appendChild(span);
        container.appendChild(labelEl);
    });
}

// Appelé depuis app.js après ajout des listeners, pour gérer le changement de route
export function setupLocationMethodListener() {
    const locationRadios = document.querySelectorAll('input[name="locationMethod"]');
    const manualCoordsDiv = document.getElementById('manualCoords');
    if (!locationRadios.length || !manualCoordsDiv) return;

    const applyLocationMethod = (method) => {
        manualCoordsDiv.style.display = method === 'manual' ? 'flex' : 'none';
    };
    applyLocationMethod(STATE.locationMethod || 'geo');

    locationRadios.forEach(radio => {
        radio.addEventListener('change', e => {
            const value = e.target.value === 'manual' ? 'manual' : 'geo';
            STATE.locationMethod = value;
            saveSettings();
            applyLocationMethod(value);
        });
    });
}

// Affichage principal de la timeline à partir de STATE.currentRoute
export function displayTimeline(currentIdx = null) {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    // ✅ DEBUG
    console.log(`[displayTimeline] STATE.currentRoute.length = ${STATE.currentRoute?.length || 0}`);

    // Si pas de route ou pas d'heure de départ, on vide juste
    if (!STATE.currentRoute || !STATE.currentRoute.length || !STATE.departureTime) {
        timeline.innerHTML = '';
        return;
    }

    // Header
    timeline.innerHTML = '';
    const headerDiv = document.createElement('div');
    headerDiv.className = 'station header';
    headerDiv.innerHTML = `<span>TIME</span><span>WAYPOINT</span><span>DELAY</span>`;
    timeline.appendChild(headerDiv);

    // On part de l'heure de départ
    let currentDate = timeStringToDate(STATE.departureTime);

    STATE.currentRoute.forEach((point, idx) => {
        const stationDiv = document.createElement('div');
        stationDiv.className = 'station';

        // Pour le point idx, l'heure d'arrivée = départ + somme des durées des segments 0..(idx-1)
        // Autrement dit : on ajoute la durée du segment PRECEDENT (route[idx-1]) pour arriver à idx
        if (idx > 0) {
            const prevPoint = STATE.currentRoute[idx - 1];
            const durSec = Number(
                prevPoint.durationEffective ??
                prevPoint.baseDurationToNext ??
                0
            );
            currentDate = new Date(currentDate.getTime() + durSec * 1000);
        }
        const arrivalTimeStr = formatTime(currentDate);

        // Nom du point (gras si gare/stop)
        const isStop = !!point.isStop;
        const nameHtml = isStop ? `<strong>${point.name}</strong>` : point.name;

        // Retard affiché
        let delayText = '';
        if (STATE.passedPoints && Object.prototype.hasOwnProperty.call(STATE.passedPoints, point.id)) {
            delayText = formatDelayMs(STATE.passedPoints[point.id]);
        } else if (currentIdx != null && idx === currentIdx + 1 && typeof STATE.currentDelay === 'number') {
            delayText = formatDelayMs(STATE.currentDelay);
        }

        stationDiv.innerHTML = `
            <span>${arrivalTimeStr}</span>
            <span>${nameHtml}</span>
            <span class="delay">${delayText}</span>
        `;

        // Styling de la station courante / passée
        if (currentIdx !== null && idx === currentIdx) {
            stationDiv.classList.add('current-station');
        } else if (currentIdx !== null && idx < currentIdx) {
            stationDiv.classList.add('passed');
        }

        timeline.appendChild(stationDiv);
    });
}

export function updateInfo(msg) {
    const infoEl = document.getElementById('info');
    if (infoEl) infoEl.innerHTML = msg;
}

// -- FONCTIONS WIDGET --

export function updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistanceKm, nextPointDistanceKm) {
    const lastLineEl = document.getElementById('last-line');
    const nextLineEl = document.getElementById('next-line');
    const currentTimeEl = document.getElementById('current-time');

    if (lastLineEl) {
        lastLineEl.innerHTML = lastPassedPoint
            ? `<span class="label-last">Last :</span> <span class="point">${lastPassedPoint.name}</span> <span class="distance-inline">· ${lastPointDistanceKm.toFixed(2)} km</span>`
            : `<span class="label-last">Last :</span> <span class="distance-inline">—</span>`;
    }

    if (nextLineEl) {
        nextLineEl.innerHTML = nextPoint
            ? `<span class="label-next">Next :</span> <span class="point">${nextPoint.name}</span> <span class="distance-inline">· ${nextPointDistanceKm.toFixed(2)} km</span>`
            : `<span class="label-next">Next :</span> <span class="distance-inline">Route ended</span>`;
    }

    if (!currentTimeEl) return;

    if (typeof STATE.currentDelay === 'number' && nextPoint && STATE.currentDelay > 30_000) {
        const minutes = Math.floor(STATE.currentDelay / 60000);
        const label = minutes > 0 ? `Delay : ${minutes} min estimated` : '';
        currentTimeEl.textContent = label;
        if (label) {
            currentTimeEl.classList.add('red');
            currentTimeEl.classList.remove('green');
        } else {
            currentTimeEl.classList.remove('red', 'green');
        }
    } else {
        currentTimeEl.textContent = '';
        currentTimeEl.classList.remove('red', 'green');
    }
}

// -- UTILITAIRES LOCAUX --

function formatDelayMs(delayMs) {
    if (typeof delayMs !== 'number') return '';
    
    // On n'affiche pas les retards négatifs (avance) ni les retards inférieurs à 1 minute
    if (delayMs < 60000) return '';

    // On affiche uniquement les minutes entières
    const minutes = Math.floor(delayMs / 60000);

    return `+${minutes} min`;
}
