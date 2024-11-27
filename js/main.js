// js/main.js

// Variables globales
let departureTime;
let timelineElement = document.getElementById("timeline");
let trackingInterval = null;  // Variable pour stocker l'intervalle
let direction = 'north-south';
let pointsDePassage = [];
let lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime;

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    populateTrajetDropdown();
    setupLocationMethodListener();
    restoreSettings(); // Restaurer les paramètres sauvegardés
    startTracking();
});  

function startTracking() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(position => {
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;

            // Mettre à jour les variables en fonction de la position actuelle
            updatePoints(userLat, userLon);

            // Mettre à jour le widget
            updateDistancesAndTime();
        }, showError, {
            maximumAge: 0,
            timeout: 5000
        });

        // Mettre à jour les informations toutes les 5 secondes
        if (trackingInterval) {
            clearInterval(trackingInterval);
        }
        trackingInterval = setInterval(() => {
            navigator.geolocation.getCurrentPosition(position => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;

                // Mettre à jour les variables en fonction de la position actuelle
                updatePoints(userLat, userLon);

                // Mettre à jour le widget
                updateDistancesAndTime();
            }, showError, {
                maximumAge: 0,
                timeout: 5000
            });
        }, 5000);
    } else {
        console.error('Geolocation is not supported by this browser.');
    }
}

function updatePoints(userLat, userLon) {
    // Logique pour mettre à jour lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime
    lastPassedPoint = getLastPassedPoint(userLat, userLon);
    nextPoint = getNextPoint(userLat, userLon);
    lastPointDistance = lastPassedPoint ? calculateDistance(userLat, userLon, lastPassedPoint.lat, lastPassedPoint.lon) : 0;
    nextPointDistance = nextPoint ? calculateDistance(userLat, userLon, nextPoint.lat, nextPoint.lon) : 0;
    theoreticalTime = calculateTheoreticalTime(departureTime, pointsDePassage, nextPoint);
}

function updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime) {
    document.getElementById('last-passed-point').textContent = lastPassedPoint ? lastPassedPoint.name : 'No previous point';
    document.getElementById('last-passed-time').textContent = lastPassedPoint ? lastPassedPoint.time : '';
    document.getElementById('last-point-distance').textContent = lastPassedPoint ? `${lastPointDistance.toFixed(2)} km` : '';
    document.getElementById('next-point').textContent = nextPoint ? nextPoint.name : 'Route ended';
    document.getElementById('next-point-time').textContent = nextPoint ? nextPoint.time : '';
    document.getElementById('next-point-distance').textContent = nextPoint ? `${nextPointDistance.toFixed(2)} km` : '';

    if (nextPoint) {
        const currentTime = new Date();
        const [theoreticalHours, theoreticalMinutes] = theoreticalTime.split(':').map(Number);
        const theoreticalDate = new Date();
        theoreticalDate.setHours(theoreticalHours, theoreticalMinutes, 0, 0);
    
        const diffMilliseconds = currentTime - theoreticalDate;
    
        if (diffMilliseconds > 0) {
            const diffMinutes = Math.floor(diffMilliseconds / 60000);
    
            if (diffMinutes === 0) {
                document.getElementById('current-time').textContent = 'On Time';
                document.getElementById('current-time').classList.add('green');
                document.getElementById('current-time').classList.remove('red');
            } else {
                document.getElementById('current-time').textContent = `+ ${diffMinutes} min`;
                document.getElementById('current-time').classList.add('red');
                document.getElementById('current-time').classList.remove('green');
            }
        } else {
            document.getElementById('current-time').textContent = 'On Time';
            document.getElementById('current-time').classList.add('green');
            document.getElementById('current-time').classList.remove('red');
        }
    } else {
        document.getElementById('current-time').textContent = '';
        document.getElementById('current-time').classList.remove('red');
        document.getElementById('current-time').classList.remove('green');
    }
}

function updateDistancesAndTime() {
    updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime);
}

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

    // Nettoyer le suivi précédent s'il existe
    if (trackingInterval) {
        navigator.geolocation.clearWatch(trackingInterval);
        trackingInterval = null;
    }

    if (selectedMethod === 'geo') {
        if (navigator.geolocation) {
            // Utilisation de watchPosition pour un suivi en continu
            trackingInterval = navigator.geolocation.watchPosition(
                showPosition,
                showError,
                { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
            );
        } else {
            document.getElementById("info").innerText = "La géolocalisation n'est pas supportée par ce navigateur.";
        }
    } else {
        getLocation();
    }
}

// Fonction pour obtenir la localisation (par géolocalisation ou manuellement)
function getLocation() {
    const selectedMethod = document.querySelector('input[name="locationMethod"]:checked').value;

    if (selectedMethod === 'geo') {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition, showError);
        } else {
            document.getElementById("info").innerText = "La géolocalisation n'est pas supportée par ce navigateur.";
        }
    } else {
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

// Fonction pour afficher la position et mettre à jour l'avancement
function showPosition(position) {
    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    // Vérifier la précision du signal GPS
    if (accuracy > 1000) {  // Seuil de 1 000 mètres pour la précision acceptable
        document.getElementById("info").innerText = `Signal GPS trop imprécis (précision de ${accuracy.toFixed(0)} mètres). Utilisation du centre de la zone approximative.`;
        
        // Utiliser le centre du cercle approximatif pour la position
        const approximatePosition = {
            lat: userLat,
            lon: userLon
        };
        processPosition(approximatePosition.lat, approximatePosition.lon);
    } else {
        // Utiliser la position actuelle si elle est suffisamment précise
        processPosition(userLat, userLon);
    }
}

// Fonction pour traiter la position utilisateur et mettre à jour la timeline

function processPosition(userLat, userLon) {
    let lastPassedPoint = null;
    let nextPoint = null;

    if (direction === 'north-south') {
        for (let i = 0; i < pointsDePassage.length; i++) {
            if (userLat <= pointsDePassage[i].lat) {
                nextPoint = pointsDePassage[i];
                lastPassedPoint = pointsDePassage[i - 1] || null;
                break;
            }
        }
        if (!nextPoint && pointsDePassage.length > 0) {
            lastPassedPoint = pointsDePassage[pointsDePassage.length - 1];
        }
    } else if (direction === 'south-north') {
        for (let i = 0; i < pointsDePassage.length; i++) {
            if (userLat >= pointsDePassage[i].lat) {
                nextPoint = pointsDePassage[i];
                lastPassedPoint = pointsDePassage[i - 1] || null;
                break;
            }
        }
        if (!nextPoint && pointsDePassage.length > 0) {
            lastPassedPoint = pointsDePassage[pointsDePassage.length - 1];
        }
    }

    // Mettre à jour les distances
    lastPointDistance = lastPassedPoint ? calculateDistance(userLat, userLon, lastPassedPoint.lat, lastPassedPoint.lon) : 0;
    nextPointDistance = nextPoint ? calculateDistance(userLat, userLon, nextPoint.lat, nextPoint.lon) : 0;

    // Mettre à jour le widget
    updateDistancesAndTime();
}

// Fonction pour calculer la distance entre deux points (en km)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        0.5 - Math.cos(dLat)/2 + 
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        (1 - Math.cos(dLon))/2;

    return R * 2 * Math.asin(Math.sqrt(a));
}

// Fonction pour obtenir le dernier point de passage
function getLastPassedPoint(userLat, userLon) {
    // Logique pour obtenir le dernier point de passage en fonction de la position actuelle
    // Exemple :
    for (let i = pointsDePassage.length - 1; i >= 0; i--) {
        if (direction === 'north-south' && userLat > pointsDePassage[i].lat) {
            return pointsDePassage[i];
        } else if (direction === 'south-north' && userLat < pointsDePassage[i].lat) {
            return pointsDePassage[i];
        }
    }
    return null;
}

// Fonction pour obtenir le prochain point de passage
function getNextPoint(userLat, userLon) {
    // Logique pour obtenir le prochain point de passage en fonction de la position actuelle
    // Exemple :
    for (let i = 0; i < pointsDePassage.length; i++) {
        if (direction === 'north-south' && userLat <= pointsDePassage[i].lat) {
            return pointsDePassage[i];
        } else if (direction === 'south-north' && userLat >= pointsDePassage[i].lat) {
            return pointsDePassage[i];
        }
    }
    return null;
}

// Fonction pour calculer l'heure théorique d'arrivée au prochain point
function calculateTheoreticalTime(departureTime, pointsDePassage, nextPoint) {
    // Logique pour calculer l'heure théorique d'arrivée au prochain point
    // Exemple :
    if (!nextPoint) return '';
    const index = pointsDePassage.indexOf(nextPoint);
    if (index === -1) return '';
    const time = new Date(departureTime);
    time.setMinutes(time.getMinutes() + (index * 10)); // Supposons que chaque point est à 10 minutes d'intervalle
    return time.toTimeString().slice(0, 5);
}