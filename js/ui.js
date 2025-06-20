// js/ui.js
import STATE, { saveSettings } from './state.js';
import { $, $$, formatTime, timeStringToDate } from './utils.js';

// -- FONCTIONS UI PRINCIPALES --

export function populateTrajetDropdown() {
    const trajetSelect = $('#routeSelect');
    trajetSelect.innerHTML = '<option value="">-- Select a route --</option>';
    STATE.trajets.forEach(trajet => {
        const opt = document.createElement('option');
        opt.value = trajet.pointsFile;
        opt.textContent = trajet.name;
        trajetSelect.appendChild(opt);
    });
    trajetSelect.value = STATE.selectedRoute || '';
}

export function setupLocationMethodListener() {
    const manualDiv = $('#manualCoords');
    $$('input[name="locationMethod"]').forEach((radio) => {
        radio.addEventListener('change', function () {
            manualDiv.style.display = this.value === 'manual' ? 'flex' : 'none';
        });
    });
}

export function displayTimeline(currentIdx = null) {
    const timeline = $('#timeline');
    if (!STATE.departureTime || !STATE.pointsDePassage.length) return;

    // Liste des gares à mettre en gras
    const gares = [
        "Paris-Lyon", "Le Creusot TGV", "Valence TGV", "Avignon TGV",
        "Lyon-Saint-Exupéry TGV", "Marseille Saint-Charles", "Macon – Loché TGV",
        "Le Creusot – Montceau – Montchanin TGV", "Aix-en-Provence TGV", "Lyon-Part-Dieu"
    ];

    // Si la timeline existe déjà avec le bon nombre de stations, on ne fait qu'une mise à jour des classes
    const stations = timeline.querySelectorAll('.station:not(.header)');
    if (stations.length === STATE.pointsDePassage.length) {
        stations.forEach((station, idx) => {
            if (currentIdx !== null && idx === currentIdx) {
                station.classList.add('current-station');
                station.classList.remove('passed');
            } else if (currentIdx !== null && idx < currentIdx) {
                station.classList.remove('current-station');
                station.classList.add('passed');
            } else {
                station.classList.remove('current-station');
                station.classList.remove('passed');
            }
        });
        return;
    }

    // Sinon, on reconstruit tout (premier affichage ou changement de trajet)
    timeline.innerHTML = '';
    const headerDiv = document.createElement('div');
    headerDiv.className = 'station header';
    headerDiv.innerHTML = `<span>Time</span><span>Waypoint</span><span></span>`;
    timeline.appendChild(headerDiv);

    let currentDate = timeStringToDate(STATE.departureTime);
    STATE.pointsDePassage.forEach((point, idx) => {
        currentDate = new Date(currentDate.getTime() + Number(point.duree) * 1000);
        const arrivalTimeStr = formatTime(currentDate);
        const stationDiv = document.createElement('div');
        stationDiv.className = 'station';

        // Mettre en gras si gare
        const isGare = gares.includes(point.name);
        stationDiv.innerHTML = `<span>${arrivalTimeStr}</span>
            <span>${isGare ? `<strong>${point.name}</strong>` : point.name}</span>
            <span class="delay"></span>`;

        // Ajout des classes selon l'état
        if (currentIdx !== null && idx === currentIdx) {
            stationDiv.classList.add('current-station');
        } else if (currentIdx !== null && idx < currentIdx) {
            stationDiv.classList.add('passed');
        }

        timeline.appendChild(stationDiv);
    });
}

export function updateInfo(msg) {
    $('#info').innerHTML = msg;
}

// -- FONCTIONS WIDGET --

// Calcul l'heure théorique d'arrivée à un point donné
export function calculateTheoreticalTime(departureTime, pointsDePassage, pointCible) {
    const [hours, minutes] = departureTime.split(':').map(Number);
    const departureDate = new Date();
    departureDate.setHours(hours, minutes, 0, 0);

    let totalDuration = 0;
    for (let point of pointsDePassage) {
        totalDuration += Number(point.duree);
        if (point === pointCible) break;
    }
    const theoreticalDate = new Date(departureDate.getTime() + totalDuration * 1000);
    return formatTime(theoreticalDate);
}

export function updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime) {
    // Last
    $('#last-passed-point').innerHTML = lastPassedPoint
      ? `<strong>${lastPassedPoint.name}</strong> <span class="distance">in ${lastPointDistance.toFixed(2)} km</span>`
      : 'None';
    $('#last-point-distance').innerHTML = ''; // Vide, plus utilisé
    $('#last-passed-theoretical').textContent = ''; // Vide, plus utilisé

    // Next
    $('#next-point').innerHTML = nextPoint
      ? `<strong>${nextPoint.name}</strong> <span class="distance">in ${nextPointDistance.toFixed(2)} km</span>`
      : 'Route ended';
    $('#next-point-distance').innerHTML = ''; // Vide, plus utilisé
    $('#next-point-theoretical').textContent = ''; // Vide, plus utilisé

    // Calcul du délai (même logique que l'ancien main.js)
    if (nextPoint && theoreticalTime) {
        const currentTime = new Date();
        const [theoreticalHours, theoreticalMinutes] = theoreticalTime.split(':').map(Number);
        const theoreticalDate = new Date();
        theoreticalDate.setHours(theoreticalHours, theoreticalMinutes, 0, 0);

        const diffMilliseconds = currentTime - theoreticalDate;

        if (diffMilliseconds > 0) {
            const diffMinutes = Math.floor(diffMilliseconds / 60000);

            if (diffMinutes === 0) {
                STATE.currentDelay = '';
                $('#current-time').textContent = 'On Time';
                $('#current-time').classList.add('green');
                $('#current-time').classList.remove('red');
            } else {
                STATE.currentDelay = `+ ${diffMinutes} min`;
                $('#current-time').textContent = STATE.currentDelay;
                $('#current-time').classList.add('red');
                $('#current-time').classList.remove('green');
            }
        } else {
            STATE.currentDelay = '';
            $('#current-time').textContent = 'On Time';
            $('#current-time').classList.add('green');
            $('#current-time').classList.remove('red');
        }
    } else {
        STATE.currentDelay = '';
        $('#current-time').textContent = '';
        $('#current-time').classList.remove('red', 'green');
    }

    updateTimelineDelays();

    // ETA au dernier point (estimation d'arrivée)
    if (STATE.pointsDePassage.length && STATE.departureTime) {
        const [hours, minutes] = STATE.departureTime.split(':').map(Number);
        const departureDate = new Date();
        departureDate.setHours(hours, minutes, 0, 0);
        let totalDuration = 0;
        STATE.pointsDePassage.forEach(point => totalDuration += Number(point.duree));
        let arrivalDate = new Date(departureDate.getTime() + totalDuration * 1000);

        // Ajout du retard éventuel à l'ETA
        let delayMinutes = 0;
        if (STATE.currentDelay && STATE.currentDelay.startsWith('+')) {
            // Ex: "+ 5 min"
            const match = STATE.currentDelay.match(/\+ ?(\d+)/);
            if (match) delayMinutes = parseInt(match[1], 10);
        }
        if (delayMinutes > 0) {
            arrivalDate = new Date(arrivalDate.getTime() + delayMinutes * 60000);
        }
        const arrivalStr = formatTime(arrivalDate);
        $('#current-time').textContent += ` • ETA: ${arrivalStr}`;
    }
}

// Fonction identique à celle de l'ancien main.js
function updateTimelineDelays() {
    const timeline = $('#timeline');
    const stations = timeline.querySelectorAll('.station');
    let isNextPoint = false;

    stations.forEach((station, index) => {
        if (index === 0) return; // Ignorer l'en-tête

        const delaySpan = station.querySelector('.delay');
        if (!delaySpan) return;

        if (station.classList.contains('current-station')) {
            isNextPoint = true; // Le prochain point sera le next point
            delaySpan.textContent = ''; // Effacer le délai sur le point courant
        } else if (isNextPoint) {
            delaySpan.textContent = STATE.currentDelay; // Afficher le délai sur le prochain point
            isNextPoint = false; // Ne plus traiter les points suivants
        } else {
            delaySpan.textContent = ''; // Effacer le délai sur tous les autres points
        }
    });
}

/* export function scrollToCurrentStation() {
    const timeline = $('#timeline');
    const stations = timeline.querySelectorAll('.station:not(.header)');
    const current = timeline.querySelector('.current-station');
    if (!current || stations.length === 0) return;

    const idx = Array.from(stations).indexOf(current);
    const targetIdx = Math.max(0, idx - 2);
    const target = stations[targetIdx];
    if (!target) return;

    // Scroll pour que la station cible soit en haut du conteneur
    timeline.scrollTop = target.offsetTop - timeline.firstElementChild.offsetTop;
} */
