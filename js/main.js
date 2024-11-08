// js/main.js

// Variables globales
let departureTime;
let timelineElement = document.getElementById("timeline");
let trackingInterval = null;  // Variable pour stocker l'intervalle
let direction = 'north-south';
let pointsDePassage = [];

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    populateTrajetDropdown();
    setupLocationMethodListener();
    restoreSettings(); // Restaurer les paramètres sauvegardés
});

// Fonction pour restaurer les réglages sauvegardés après actualisation de la page
function restoreSettings() {
    const savedRoute = localStorage.getItem('selectedRoute');
    const savedDepartureTime = localStorage.getItem('departureTime');
    const savedLocationMethod = localStorage.getItem('locationMethod');
    const savedManualLat = localStorage.getItem('manualLat');
    const savedManualLon = localStorage.getItem('manualLon');

    if (savedRoute) {
        document.getElementById('routeSelect').value = savedRoute;
        loadSelectedTrajet(); // Recharger la route sélectionnée
    }
    if (savedDepartureTime) {
        document.getElementById('departure-time').value = savedDepartureTime;
    }
    if (savedLocationMethod) {
        document.querySelector(`input[name="locationMethod"][value="${savedLocationMethod}"]`).checked = true;
        if (savedLocationMethod === 'manual') {
            document.getElementById('manualCoords').style.display = 'block';
        }
    }
    if (savedManualLat) {
        document.getElementById('manualLat').value = savedManualLat;
    }
    if (savedManualLon) {
        document.getElementById('manualLon').value = savedManualLon;
    }
}

// Fonction pour sauvegarder les réglages dans localStorage
function saveSettings() {
    const selectedRoute = document.getElementById('routeSelect').value;
    const departureTime = document.getElementById('departure-time').value;
    const locationMethod = document.querySelector('input[name="locationMethod"]:checked').value;
    const manualLat = document.getElementById('manualLat').value;
    const manualLon = document.getElementById('manualLon').value;

    localStorage.setItem('selectedRoute', selectedRoute);
    localStorage.setItem('departureTime', departureTime);
    localStorage.setItem('locationMethod', locationMethod);
    if (manualLat) {
        localStorage.setItem('manualLat', manualLat);
    }
    if (manualLon) {
        localStorage.setItem('manualLon', manualLon);
    }
}

// Ajouter l'appel à la fonction `saveSettings` à chaque fois qu'une donnée est modifiée
document.getElementById('routeSelect').addEventListener('change', saveSettings);
document.getElementById('departure-time').addEventListener('change', saveSettings);
document.querySelectorAll('input[name="locationMethod"]').forEach(radio => {
    radio.addEventListener('change', saveSettings);
});
document.getElementById('manualLat').addEventListener('input', saveSettings);
document.getElementById('manualLon').addEventListener('input', saveSettings);

// Fonction pour peupler le menu déroulant des trajets
function populateTrajetDropdown() {
    const trajetSelect = document.getElementById('routeSelect'); // Utiliser 'routeSelect' pour correspondre à l'ID dans l'HTML

    if (typeof trajets !== 'undefined' && Array.isArray(trajets) && trajets.length > 0) {
        trajets.forEach(trajet => {
            const option = document.createElement('option');
            option.value = trajet.pointsFile;  // Utiliser 'pointsFile' comme valeur
            option.textContent = trajet.name;
            trajetSelect.appendChild(option);
        });

        // Optionnel : Charger le premier trajet par défaut si souhaité
        // trajetSelect.selectedIndex = 1;
        // loadSelectedTrajet();
    } else {
        console.error("Aucun trajet défini dans 'trajets'.");
    }
}

// Fonction pour charger le trajet sélectionné
function loadSelectedTrajet() {
    const trajetSelect = document.getElementById('routeSelect');
    const selectedPointsFile = trajetSelect.value;

    if (!selectedPointsFile) {
        console.warn("Aucun fichier de points sélectionné.");
        pointsDePassage = [];
        direction = 'north-south'; // Valeur par défaut ou réinitialiser
        return;
    }

    // Trouver le trajet sélectionné dans 'trajets'
    const trajet = trajets.find(t => t.pointsFile === selectedPointsFile);
    if (!trajet) {
        console.error(`Trajet non trouvé pour le fichier ${selectedPointsFile}`);
        return;
    }

    // Charger le fichier JSON des points de passage
    fetch(`data/${selectedPointsFile}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            pointsDePassage = data;
            direction = trajet.direction;
            console.log("Points de passage chargés : ", pointsDePassage);
            // Optionnel : Afficher la timeline après le chargement des points
            // displayTimeline();
        })
        .catch(error => {
            console.error("Erreur lors du chargement du fichier des points:", error);
        });
}

// Fonction pour configurer l'affichage des champs manuels en fonction de la méthode de localisation
function setupLocationMethodListener() {
    document.querySelectorAll('input[name="locationMethod"]').forEach((radio) => {
        radio.addEventListener('change', function () {
            if (this.value === 'manual') {
                document.getElementById('manualCoords').style.display = 'block';
            } else {
                document.getElementById('manualCoords').style.display = 'none';
            }
        });
    });
}

// Fonction pour calculer l'heure d'arrivée de manière cumulative
function calculateArrivalTime(currentDate, duration) {
    // Assurez-vous que 'duration' est en secondes
    const durationMilliseconds = duration * 1000; // Convertir en millisecondes
    const newDate = new Date(currentDate.getTime() + durationMilliseconds);
    return newDate;
}

// Fonction pour afficher la timeline sans les retards
function displayTimeline() {
    if (!departureTime) {
        console.error("departureTime n'est pas défini.");
        return;
    }

    if (!pointsDePassage || pointsDePassage.length === 0) {
        console.error("pointsDePassage n'est pas défini ou est vide.");
        return;
    }

    // Réinitialiser la timeline avec l'en-tête
    timelineElement.innerHTML = `
        <div class="station header">
            <span>PK</span>
            <span>Time</span>
            <span>Waypoint</span>
        </div>
    `;

    let [hours, minutes] = departureTime.split(':').map(Number);
    let currentDate = new Date();
    currentDate.setHours(hours);
    currentDate.setMinutes(minutes);
    currentDate.setSeconds(0);
    currentDate.setMilliseconds(0);

    pointsDePassage.forEach((point, index) => {
        const dureeSeconds = Number(point.duree);
        if (isNaN(dureeSeconds)) {
            console.error(`Durée invalide pour le point ${point.name}: ${point.duree}`);
            return;
        }

        // Calculer l'heure d'arrivée de manière cumulative
        const arrivalTime = calculateArrivalTime(currentDate, dureeSeconds);
        const arrivalTimeStr = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Vérification si c'est une gare
        const gares = ["Paris-Lyon", "Le Creusot – Montceau – Montchanin", "Valence TGV", "Avignon TGV", "Lyon-Saint-Exupéry TGV", "Marseille Saint-Charles", "Macon – Loché TGV", "Le Creusot – Montceau – Montchanin TGV", "Aix-en-Provence TGV", "Lyon-Part-Dieu"];
        let pointName = gares.includes(point.name) ? `<strong>${point.name}</strong>` : point.name;

        // Ajouter chaque point à la timeline avec le PK formaté
        const stationDiv = document.createElement("div");
        stationDiv.classList.add("station");
        stationDiv.innerHTML = `
            <span class="pk">${point.PK.toFixed(3)}</span>  <!-- PK avec la classe pk -->
            <span>${arrivalTimeStr}</span>      <!-- Heure en second -->
            <span>${pointName}</span>           <!-- Nom en dernier -->
        `;

        timelineElement.appendChild(stationDiv);

        // Mettre à jour l'heure pour le prochain point
        currentDate = arrivalTime;
    });
}

// Fonction pour démarrer le suivi
function startTracking() {
    const departureInput = document.getElementById("departure-time").value;
    if (!departureInput) {
        alert("Please select a departure time.");
        return;
    }

    if (!pointsDePassage || pointsDePassage.length === 0) {
        alert("Please select a route.");
        return;
    }

    departureTime = departureInput;
    displayTimeline();

    const selectedMethod = document.querySelector('input[name="locationMethod"]:checked').value;

    // Nettoyer l'intervalle précédent s'il existe
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }

    if (selectedMethod === 'geo') {
        // Si l'utilisateur choisit la géolocalisation, on met à jour toutes les 10 secondes
        if (navigator.geolocation) {
            // Appeler une fois immédiatement
            navigator.geolocation.getCurrentPosition(showPosition, showError);

            // Actualiser la position toutes les 10 secondes
            trackingInterval = setInterval(() => {
                navigator.geolocation.getCurrentPosition(showPosition, showError);
            }, 10000);  // 10 000 millisecondes = 10 secondes
        } else {
            document.getElementById("info").innerText = "La géolocalisation n'est pas supportée par ce navigateur.";
        }
    } else {
        // Si l'utilisateur choisit la méthode manuelle, obtenir la localisation une seule fois
        getLocation();
    }
}

// Fonction pour obtenir la localisation (par géolocalisation ou manuellement)
function getLocation() {
    const selectedMethod = document.querySelector('input[name="locationMethod"]:checked').value;

    if (selectedMethod === 'geo') {
        // Utiliser la géolocalisation de l'appareil
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition, showError);
        } else {
            document.getElementById("info").innerText = "La géolocalisation n'est pas supportée par ce navigateur.";
        }
    } else {
        // Utiliser les coordonnées manuellement saisies
        const manualLat = parseFloat(document.getElementById('manualLat').value);
        const manualLon = parseFloat(document.getElementById('manualLon').value);

        if (!isNaN(manualLat) && !isNaN(manualLon)) {
            const manualPosition = {
                coords: {
                    latitude: manualLat,
                    longitude: manualLon
                }
            };
            showPosition(manualPosition);
        } else {
            document.getElementById("info").innerText = "Veuillez saisir des coordonnées valides.";
        }
    }
}

// Fonction pour afficher la position et mettre à jour l'avancement
function showPosition(position) {
    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;

    // Déterminer le dernier point franchi et le prochain point en fonction de la direction
    let lastPassedPoint = null;
    let nextPoint = null;

    if (direction === 'north-south') {
        // Pour Nord-Sud : latitudes décroissantes
        for (let i = 0; i < pointsDePassage.length; i++) {
            if (userLat <= pointsDePassage[i].lat) {
                lastPassedPoint = pointsDePassage[i];
                nextPoint = pointsDePassage[i + 1] || null;
                break;
            }
        }
        // Si l'utilisateur a dépassé tous les points
        if (!lastPassedPoint && pointsDePassage.length > 0) {
            lastPassedPoint = pointsDePassage[pointsDePassage.length - 1];
            nextPoint = null;
        }
    } else if (direction === 'south-north') {
        // Pour Sud-Nord : latitudes croissantes
        for (let i = 0; i < pointsDePassage.length; i++) {
            if (userLat >= pointsDePassage[i].lat) {
                lastPassedPoint = pointsDePassage[i];
                nextPoint = pointsDePassage[i + 1] || null;
                break;
            }
        }
        // Si l'utilisateur a dépassé tous les points
        if (!lastPassedPoint && pointsDePassage.length > 0) {
            lastPassedPoint = pointsDePassage[0];
            nextPoint = null;
        }
    }

    // Mettre à jour la classe 'current-station' dans la timeline
    Array.from(timelineElement.children).forEach(station => {
        station.classList.remove("current-station");
    });

    if (lastPassedPoint) {
        Array.from(timelineElement.children).forEach(station => {
            if (station.textContent.includes(lastPassedPoint.name)) {
                station.classList.add("current-station");
            }
        });
    }

    // Calculer la distance restante (optionnel, peut être amélioré)
    let distance = 0;
    if (nextPoint) {
        distance = haversineDistance(userLat, userLon, nextPoint.lat, nextPoint.lon);
    }

    // Affichage de la position et du prochain point de passage
    if (nextPoint) {
        document.getElementById("info").innerHTML = `
            <strong>Current position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>
            <strong>Next waypoint :</strong> ${nextPoint.name} (PK: ${nextPoint.PK.toFixed(3)})<br>
            <strong>Distance remaining :</strong> ${distance.toFixed(2)} km
        `;
    } else {
        document.getElementById("info").innerHTML = `
            <strong>Current position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>
            <strong>Route ended.</strong><br>
            <strong>Remaining distance :</strong> ${distance.toFixed(2)} km
        `;
    }
}

// Fonction pour gérer les erreurs de géolocalisation
function showError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            document.getElementById("info").innerText = "L'utilisateur a refusé la demande de géolocalisation.";
            break;
        case error.POSITION_UNAVAILABLE:
            document.getElementById("info").innerText = "Les informations de localisation ne sont pas disponibles.";
            break;
        case error.TIMEOUT:
            document.getElementById("info").innerText = "La requête de géolocalisation a expiré.";
            break;
        case error.UNKNOWN_ERROR:
            document.getElementById("info").innerText = "Une erreur inconnue s'est produite.";
            break;
    }
}

