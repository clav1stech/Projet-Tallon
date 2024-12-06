// js/main.js

// Variables globales
let departureTime;
let timelineElement = document.getElementById("timeline");
let trackingInterval = null;  // Variable pour stocker l'intervalle
let direction = 'north-south';
let pointsDePassage = [];
let currentDelay = ''; // Déclarer en haut du script
let scrollTimeout;

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    populateTrajetDropdown();
    setupLocationMethodListener();
    restoreSettings(); // Restaurer les paramètres sauvegardés

    const timeline = document.getElementById('timeline');
    
    // Empêcher le scroll de la page quand on scroll dans la timeline
    timeline.addEventListener('wheel', (e) => {
        if (timeline.contains(e.target)) {
            e.preventDefault();
            timeline.scrollTop += e.deltaY;
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                const currentStation = document.querySelector('.current-station');
                if (currentStation) {
                    const headerHeight = timeline.querySelector('.header').offsetHeight;
                    const stationHeight = currentStation.offsetHeight;
                    timeline.scrollTo({
                        top: currentStation.offsetTop - headerHeight - stationHeight,
                        behavior: 'smooth'
                    });
                }
            }, 30000);
        }
    });
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
            <span>Delay</span>
        </div>
    `;

    let [hours, minutes] = departureTime.split(':').map(Number);
    let currentDate = new Date();
    currentDate.setHours(hours);
    currentDate.setMinutes(minutes);
    currentDate.setSeconds(0);
    currentDate.setMilliseconds(0);

    // Variables pour le calcul du délai
    let nextPointFound = false;
    let delayValue = '';
    let currentTime = new Date();
    currentTime.setSeconds(0, 0); // Arrondir à la minute près

    pointsDePassage.forEach((point, index) => {
        const dureeSeconds = Number(point.duree);
        if (isNaN(dureeSeconds)) {
            console.error(`La durée pour le point ${point.name} n'est pas un nombre valide.`);
            return;
        }

        // Calculer l'heure prévue d'arrivée pour ce point
        currentDate = calculateArrivalTime(currentDate, dureeSeconds);
        const arrivalTimeStr = currentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Calculer le délai
        let delayStr = '';
        let scheduledArrivalTime = new Date(currentDate);
        scheduledArrivalTime.setSeconds(0, 0); // Arrondir à la minute près

        if (scheduledArrivalTime < currentTime) {
            // Point déjà passé, ne rien afficher
            delayStr = '';
        } else if (!nextPointFound) {
            // Prochain point
            nextPointFound = true;
            if (scheduledArrivalTime < currentTime) {
                const diffMinutes = Math.floor((currentTime - scheduledArrivalTime) / 60000);
                delayValue = `+ ${diffMinutes} min`;
            } else {
                delayValue = '';
            }
            delayStr = delayValue;
        } else {
            // Points à venir, afficher le même délai que le prochain point
            delayStr = delayValue;
        }

        // Créer l'élément de station
        const stationDiv = document.createElement('div');
        stationDiv.classList.add('station');

        const pkSpan = document.createElement('span');
        pkSpan.textContent = point.PK.toFixed(3); // Use 'PK' instead of 'pk'

        const timeSpan = document.createElement('span');
        timeSpan.textContent = arrivalTimeStr;

        const nameSpan = document.createElement('span');
        const gares = ["Paris-Lyon", "Le Creusot TGV", "Valence TGV", "Avignon TGV", "Lyon-Saint-Exupéry TGV", "Marseille Saint-Charles", "Macon – Loché TGV", "Le Creusot – Montceau – Montchanin TGV", "Aix-en-Provence TGV", "Lyon-Part-Dieu"];
        nameSpan.innerHTML = gares.includes(point.name) ? `<strong>${point.name}</strong>` : point.name;

        const delaySpan = document.createElement('span');
        delaySpan.classList.add('delay'); // Ajouter cette ligne
        delaySpan.textContent = delayStr;
        stationDiv.appendChild(pkSpan);
        stationDiv.appendChild(timeSpan);
        stationDiv.appendChild(nameSpan);
        stationDiv.appendChild(delaySpan);

        timelineElement.appendChild(stationDiv);
    });
}

// Start tracking
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

    // Clean previous tracking
    if (trackingInterval) {
        navigator.geolocation.clearWatch(trackingInterval);
        trackingInterval = null;
    }

    if (selectedMethod === 'geo') {
        if (navigator.geolocation) {
            // Continous tracking
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

// Get loc
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

// Handle geoloc errors
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

// Update position and display
function showPosition(position) {
    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    // Geoloc accuracy
    if (accuracy > 1000) {  
        document.getElementById("info").innerText = `Signal GPS trop imprécis (précision de ${accuracy.toFixed(0)} mètres). Utilisation du centre de la zone approximative.`;
        
        const approximatePosition = {
            lat: userLat,
            lon: userLon
        };
        processPosition(approximatePosition.lat, approximatePosition.lon);
    } else {
    
        processPosition(userLat, userLon);
    }
}

// Process geoloc and update timeline

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

    // Réinitialiser les classes des points de passage
    Array.from(timelineElement.children).forEach(station => {
        station.classList.remove("current-station");
    });

    // Mettre en vert le dernier point de passage dépassé
    if (lastPassedPoint) {
        Array.from(timelineElement.children).forEach(station => {
            if (station.textContent.includes(lastPassedPoint.name)) {
                station.classList.add("current-station");
            }
        });
    }

    let lastPointDistance = 0;
    let nextPointDistance = 0;
    if (lastPassedPoint) {
        lastPointDistance = haversineDistance(userLat, userLon, lastPassedPoint.lat, lastPassedPoint.lon);
    }
    if (nextPoint) {
        nextPointDistance = haversineDistance(userLat, userLon, nextPoint.lat, nextPoint.lon);
    }

    const theoreticalTime = nextPoint ? calculateTheoreticalTime(departureTime, pointsDePassage, nextPoint) : '';

    updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime);
    updateTimelineDelays(); // Appeler la fonction pour mettre à jour les délais

    if (nextPoint) {
        document.getElementById("info").innerHTML = `
            <strong>Current position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>
            <strong>Next waypoint :</strong> ${nextPoint.name} (in ${nextPointDistance.toFixed(2)} km)<br>
            <strong>Theoretical time :</strong> ${theoreticalTime}
        `;
    } else {
        document.getElementById("info").innerHTML = `
            <strong>Current position :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>
            <strong>No more waypoints ahead.</strong>
        `;
    }

    // Scroll automatique si pas d'interaction récente
    function scrollToCurrentStation() {
        const currentStation = document.querySelector('.current-station');
        if (currentStation) {
            const timeline = document.getElementById('timeline');
            const headerHeight = timeline.querySelector('.header').offsetHeight;
            const stationHeight = currentStation.offsetHeight;
            
            // Position pour que la station courante soit en 2ème position
            const scrollPosition = currentStation.offsetTop - headerHeight - stationHeight;
            
            timeline.scrollTo({
                top: scrollPosition,
                behavior: 'smooth'
            });
        }
    }

    // Gestionnaire de scroll manuel
    const timeline = document.getElementById('timeline');
    timeline.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(scrollToCurrentStation, 30000); // 30 secondes
    });

    // Gestionnaire de touch pour mobile
    timeline.addEventListener('touchstart', () => {
        clearTimeout(scrollTimeout);
    });

    timeline.addEventListener('touchend', () => {
        scrollTimeout = setTimeout(scrollToCurrentStation, 30000);
    });

    // Scroll initial
    scrollToCurrentStation();
}

function updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistance, nextPointDistance, theoreticalTime) {
    // Mise à jour des points existants
    document.getElementById('last-passed-point').textContent = lastPassedPoint ? lastPassedPoint.name : 'None';
    document.getElementById('last-passed-time').textContent = lastPassedPoint ? lastPassedPoint.time : '';
    document.getElementById('last-point-distance').textContent = lastPassedPoint ? `${lastPointDistance.toFixed(2)} km` : '';
    document.getElementById('next-point').textContent = nextPoint ? nextPoint.name : 'Route ended';
    document.getElementById('next-point-time').textContent = nextPoint ? nextPoint.time : '';
    document.getElementById('next-point-distance').textContent = nextPoint ? `${nextPointDistance.toFixed(2)} km` : '';

    // Ajout des heures théoriques
    if (lastPassedPoint) {
        const lastTheoreticalTime = calculateTheoreticalTime(departureTime, pointsDePassage, lastPassedPoint);
        document.getElementById('last-passed-theoretical').textContent = lastTheoreticalTime;
    } else {
        document.getElementById('last-passed-theoretical').textContent = '';
    }
    
    document.getElementById('next-point-theoretical').textContent = theoreticalTime || '';

    // Reste de votre code...
    if (nextPoint) {
        const currentTime = new Date();
        const [theoreticalHours, theoreticalMinutes] = theoreticalTime.split(':').map(Number);
        const theoreticalDate = new Date();
        theoreticalDate.setHours(theoreticalHours, theoreticalMinutes, 0, 0);
    
        // Calcul de la différence en millisecondes
        const diffMilliseconds = currentTime - theoreticalDate;
    
        if (diffMilliseconds > 0) {
            const diffMinutes = Math.floor(diffMilliseconds / 60000);
    
            if (diffMinutes === 0) {
                currentDelay = '';
                document.getElementById('current-time').textContent = 'On Time';
                document.getElementById('current-time').classList.add('green');
                document.getElementById('current-time').classList.remove('red');
            } else {
                currentDelay = `+ ${diffMinutes} min`;
                // currentDelay = '+ 5 min';
                document.getElementById('current-time').textContent = currentDelay;
                document.getElementById('current-time').classList.add('red');
                document.getElementById('current-time').classList.remove('green');
                updateTimelineDelays();
            }
        } else {
            currentDelay = '';
            document.getElementById('current-time').textContent = 'On Time';
            document.getElementById('current-time').classList.add('green');
            document.getElementById('current-time').classList.remove('red');
        }
    } else {
        currentDelay = '';
        document.getElementById('current-time').textContent = '';
        document.getElementById('current-time').classList.remove('red');
        document.getElementById('current-time').classList.remove('green');
    }

    // **Ajout de la Classe 'current-station'**
    const stations = document.querySelectorAll('.station');
    stations.forEach((station) => {
        const waypoint = station.querySelector('span:nth-child(3)').textContent.trim();
        if (lastPassedPoint && waypoint === lastPassedPoint.name) {
            station.classList.add('current-station');
            console.log(`Classe 'current-station' ajoutée à la station: ${waypoint}`);
        } else {
            station.classList.remove('current-station');
        }
    });
}

function calculateTheoreticalTime(departureTime, pointsDePassage, nextPoint) {
    const [hours, minutes] = departureTime.split(':').map(Number);
    const departureDate = new Date();
    departureDate.setHours(hours, minutes, 0, 0);

    let totalDuration = 0;
    for (let point of pointsDePassage) {
        totalDuration += point.duree;
        if (point === nextPoint) break;
    }

    const theoreticalTime = new Date(departureDate.getTime() + totalDuration * 1000);
    return theoreticalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateTimelineDelays() {
    const stations = document.querySelectorAll('.station');
    let nextPointFound = false;

    stations.forEach((station, index) => {
        if (index === 0) return; // Ignorer l'en-tête

        const delaySpan = station.querySelector('.delay');
        if (!delaySpan) {
            console.log(`Aucun élément avec la classe 'delay' trouvé dans la station à l'index ${index}`);
            return;
        }

        console.log(`Mise à jour du délai pour la station à l'index ${index} avec currentDelay = '${currentDelay}'`);

        if (station.classList.contains('current-station')) {
            nextPointFound = true;
            delaySpan.textContent = currentDelay;
        } else if (nextPointFound) {
            delaySpan.textContent = currentDelay;
        } else {
            delaySpan.textContent = '';
        }
    });
}
