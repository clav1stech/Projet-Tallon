import STATE, { restoreSettings, saveSettings } from './state.js';
import { $, $$ } from './utils.js';
import { populateTrajetDropdown, setupLocationMethodListener, displayTimeline, updateInfo, updateTrackingWidget, scrollToCurrentStation, calculateTheoreticalTime } from './ui.js';
import { geoErrorMessage, haversineDistance } from './geo.js';

let trackingInterval = null; // Ajouter cette variable en haut du fichier

// Chargement et initialisation DOM
document.addEventListener('DOMContentLoaded', () => {
    restoreSettings();
    populateTrajetDropdown();
    setupLocationMethodListener();

    // Synchronise les champs du formulaire avec l'état restauré
    $('#routeSelect').value = STATE.selectedRoute || '';
    $('#departure-time').value = STATE.departureTime || '';
    $$('input[name="locationMethod"]').forEach(radio => {
        radio.checked = (radio.value === STATE.locationMethod);
    });
    $('#manualLat').value = STATE.manualLat || '';
    $('#manualLon').value = STATE.manualLon || '';

    $('#routeSelect').addEventListener('change', (e) => {
        STATE.selectedRoute = e.target.value;
        saveSettings();
        loadSelectedTrajet();
    });
    $('#departure-time').addEventListener('change', (e) => {
        STATE.departureTime = e.target.value;
        saveSettings();
    });
    $$('input[name="locationMethod"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            STATE.locationMethod = e.target.value;
            saveSettings();
        });
    });
    $('#manualLat').addEventListener('input', (e) => {
        STATE.manualLat = e.target.value;
        saveSettings();
    });
    $('#manualLon').addEventListener('input', (e) => {
        STATE.manualLon = e.target.value;
        saveSettings();
    });

    $('#start-btn')?.addEventListener('click', startTracking);

    if (STATE.selectedRoute) loadSelectedTrajet();
});

function loadSelectedTrajet() {
    const selectedPointsFile = STATE.selectedRoute;
    if (!selectedPointsFile) {
        STATE.pointsDePassage = [];
        STATE.direction = 'north-south';
        displayTimeline();
        return;
    }
    const trajet = STATE.trajets.find(t => t.pointsFile === selectedPointsFile);
    if (!trajet) {
        updateInfo('Trajet non trouvé');
        return;
    }
    fetch(`data/${selectedPointsFile}`)
        .then(r => r.json())
        .then(data => {
            STATE.pointsDePassage = data;
            STATE.direction = trajet.direction;
            displayTimeline();
        })
        .catch(e => updateInfo("Erreur lors du chargement du fichier des points"));
}

function startTracking() {
    if (!STATE.departureTime) {
        alert("Please select a departure time.");
        return;
    }
    if (!STATE.pointsDePassage.length) {
        alert("Please select a route.");
        return;
    }
    displayTimeline();

    // Arrêter l'ancien interval s'il existe
    if (trackingInterval) {
        clearInterval(trackingInterval);
    }

    // Fonction pour obtenir et traiter la position
    const processCurrentPosition = () => {
        if (STATE.locationMethod === 'geo') {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(showPosition, showError, { 
                    enableHighAccuracy: true, 
                    maximumAge: 0, 
                    timeout: 10000 
                });
            } else {
                updateInfo("La géolocalisation n'est pas supportée par ce navigateur.");
            }
        } else {
            const manualLat = parseFloat(STATE.manualLat);
            const manualLon = parseFloat(STATE.manualLon);
            if (!isNaN(manualLat) && !isNaN(manualLon)) {
                showPosition({ coords: { latitude: manualLat, longitude: manualLon, accuracy: 0 } });
            } else {
                updateInfo("Veuillez saisir des coordonnées valides.");
            }
        }
    };

    // Première exécution immédiate
    processCurrentPosition();

    // Puis répéter toutes les 60 secondes (60000 ms)
    trackingInterval = setInterval(processCurrentPosition, 60000);
}

function showError(error) {
    updateInfo(geoErrorMessage(error));
}

function showPosition(position) {
    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;

    let lastPassedPoint = null, nextPoint = null, lastPassedIdx = null;
    if (STATE.direction === 'north-south') {
        for (let i = 0; i < STATE.pointsDePassage.length; i++) {
            if (userLat <= STATE.pointsDePassage[i].lat) {
                nextPoint = STATE.pointsDePassage[i];
                lastPassedPoint = STATE.pointsDePassage[i - 1] || null;
                lastPassedIdx = i - 1;
                break;
            }
        }
        if (!nextPoint && STATE.pointsDePassage.length > 0) {
            lastPassedPoint = STATE.pointsDePassage[STATE.pointsDePassage.length - 1];
            lastPassedIdx = STATE.pointsDePassage.length - 1;
        }
    } else {
        for (let i = 0; i < STATE.pointsDePassage.length; i++) {
            if (userLat >= STATE.pointsDePassage[i].lat) {
                nextPoint = STATE.pointsDePassage[i];
                lastPassedPoint = STATE.pointsDePassage[i - 1] || null;
                lastPassedIdx = i - 1;
                break;
            }
        }
        if (!nextPoint && STATE.pointsDePassage.length > 0) {
            lastPassedPoint = STATE.pointsDePassage[STATE.pointsDePassage.length - 1];
            lastPassedIdx = STATE.pointsDePassage.length - 1;
        }
    }

    let lastPointDistance = 0;
    let nextPointDistance = 0;
    if (lastPassedPoint) {
        lastPointDistance = haversineDistance(userLat, userLon, lastPassedPoint.lat, lastPassedPoint.lon);
    }
    if (nextPoint) {
        nextPointDistance = haversineDistance(userLat, userLon, nextPoint.lat, nextPoint.lon);
    }

    // Calcul de l'heure théorique du prochain point (pour widget)
    let theoreticalTime = '';
    if (nextPoint) {
        theoreticalTime = calculateTheoreticalTime(STATE.departureTime, STATE.pointsDePassage, nextPoint);
    }

    // IMPORTANT: Afficher la timeline AVANT de mettre à jour le widget
    // Utiliser Math.max(0, lastPassedIdx) pour éviter les indices négatifs
    const currentIdx = Math.max(0, lastPassedIdx || 0);
    displayTimeline(currentIdx);
    
    // MAJ du widget complet
    updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime);

    scrollToCurrentStation(); // Ceci positionnera la timeline après chaque update

    updateInfo(
        `<strong>Current position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>` +
        (nextPoint
            ? `<strong>Next waypoint :</strong> ${nextPoint.name} (in ${nextPointDistance.toFixed(2)} km)<br><strong>Theoretical time :</strong> ${theoreticalTime}`
            : "<strong>No more waypoints ahead.</strong>")
    );
}
