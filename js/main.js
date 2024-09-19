// js/main.js

// Variables globales
let departureTime;
let timelineElement = document.getElementById("timeline");
let trackingInterval = null;  // Variable pour stocker l'intervalle
let selectedTrajet = null;
let direction = 'north-south';
let pointsDePassage = [];

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    populateTrajetDropdown();
    setupLocationMethodListener();
});

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

        // Charger le premier trajet par défaut si nécessaire
        trajetSelect.selectedIndex = 0;
        loadSelectedTrajet();  // Appel à la fonction pour charger le trajet sélectionné

        // Ajouter un écouteur d'événement pour le changement de sélection
        trajetSelect.addEventListener('change', loadSelectedTrajet);
    } else {
        console.error("Aucun trajet défini dans 'trajets'.");
    }
}



// Fonction pour charger le trajet sélectionné
function loadSelectedTrajet() {
    const trajetSelect = document.getElementById('routeSelect');
    const selectedPointsFile = trajetSelect.value;

    // Charger dynamiquement le fichier de points correspondant
    const script = document.createElement('script');
    script.src = `data/${selectedPointsFile}`;  // Chemin du fichier à charger
    script.onload = () => {
        // Le fichier a été chargé avec succès
        if (selectedPointsFile === 'points_route1.js') {
            pointsDePassage = pointsRoute1;
        } else if (selectedPointsFile === 'points_route2.js') {
            pointsDePassage = pointsRoute2;
        }
        console.log("Points de passage chargés : ", pointsDePassage);
        displayTimeline();  // Appel à l'affichage de la timeline une fois les points chargés
    };
    script.onerror = () => {
        console.error("Erreur lors du chargement du fichier des points.");
    };

    document.body.appendChild(script);  // Ajoutez le script dynamiquement au document
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

// Fonction pour calculer l'heure d'arrivée avec retard
function calculateArrivalTime(startTime, duration, totalRetardSeconds = 0) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(hours);
    startDate.setMinutes(minutes);
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);

    // Ajouter la durée (en secondes) et le retard accumulé (en secondes)
    startDate.setSeconds(startDate.getSeconds() + duration + totalRetardSeconds);
    return startDate;
}

// Fonction pour afficher la timeline avec les heures d'arrivée prévues et les champs de retard
function displayTimeline() {
    // Réinitialiser la timeline avec l'en-tête
    timelineElement.innerHTML = `
        <div class="station header">
            <span>Heure</span>
            <span>PK</span>
            <span>Nom du Point</span>
            <span>Retard (min)</span>
        </div>
    `;

    let [hours, minutes] = departureTime.split(':').map(Number);
    let currentDate = new Date();
    currentDate.setHours(hours);
    currentDate.setMinutes(minutes);
    currentDate.setSeconds(0);
    currentDate.setMilliseconds(0);

    let totalRetardSeconds = 0;

    pointsDePassage.forEach((point, index) => {
        // Récupérer la valeur du retard saisie par l'utilisateur
        const retardInputId = `retard-${index}`;
        const retardMinutes = parseInt(document.getElementById(retardInputId)?.value) || 0;
        totalRetardSeconds += retardMinutes * 60;

        // Calculer l'heure d'arrivée avec le retard accumulé
        const arrivalTime = calculateArrivalTime(departureTime, point.duree, totalRetardSeconds);
        const arrivalTimeStr = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Vérification si c'est une gare
        const gares = ["Paris-Lyon", "Valence TGV", "Avignon TGV", "Lyon-Saint-Exupéry TGV", "Marseille Saint-Charles", "Macon – Loché TGV", "Le Creusot – Montceau – Montchanin TGV", "Aix-en-Provence TGV"];
        let pointName = gares.includes(point.name) ? `<strong>${point.name}</strong>` : point.name;

        // Appliquer la classe 'delayed' si retard > 0
        const delayedClass = retardMinutes > 0 ? 'delayed' : '';

        // Ajouter chaque point à la timeline avec le PK formaté
        const stationDiv = document.createElement("div");
        stationDiv.classList.add("station", delayedClass);
        stationDiv.innerHTML = `
            <span>${arrivalTimeStr}</span>
            <span>${point.PK.toFixed(3)}</span>
            <span>${pointName}</span>
            <span><input type="number" id="${retardInputId}" min="0" step="1" value="0" style="width: 60px;"></span>
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
        alert("Veuillez entrer une heure de départ.");
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
    const userLat = position.coords.latitude;  // On se base uniquement sur la latitude de l'utilisateur

    // Trouver le point de passage le plus proche basé sur la direction
    let currentPoint = null;
    let nextPoint = null;

    // Si la direction est 'north-south' (du nord vers le sud)
    if (direction === 'north-south') {
        // Trouver le dernier point dont la latitude est inférieure ou égale à celle de l'utilisateur
        currentPoint = pointsDePassage.reduce((prev, point) => {
            return (point.lat <= userLat) ? point : prev;
        }, null);

        // Trouver le premier point dont la latitude est supérieure à celle de l'utilisateur
        nextPoint = pointsDePassage.find(point => point.lat > userLat);
    } 
    // Si la direction est 'south-north' (du sud vers le nord)
    else if (direction === 'south-north') {
        // Trouver le dernier point dont la latitude est supérieure ou égale à celle de l'utilisateur
        currentPoint = pointsDePassage.reduce((prev, point) => {
            return (point.lat >= userLat) ? point : prev;
        }, null);

        // Trouver le premier point dont la latitude est inférieure à celle de l'utilisateur
        nextPoint = pointsDePassage.find(point => point.lat < userLat);
    }

    // Retirer la classe 'current-station' de toutes les stations
    Array.from(timelineElement.children).forEach(station => {
        station.classList.remove("current-station");
    });

    // Ajouter la classe 'current-station' au point actuel
    if (currentPoint) {
        Array.from(timelineElement.children).forEach(station => {
            if (station.textContent.includes(currentPoint.name)) {
                station.classList.add("current-station");
            }
        });
    }

    // Affichage de la position et du prochain point de passage avec la distance en latitude
    if (nextPoint) {
        document.getElementById("info").innerHTML = `
            <strong>Position actuelle :</strong> ${userLat.toFixed(5)}<br>
            <strong>Prochain point de passage :</strong> ${nextPoint.name} (PK: ${nextPoint.PK.toFixed(3)})<br>
            <strong>Latitude du prochain point :</strong> ${nextPoint.lat.toFixed(5)}
        `;
    } else {
        document.getElementById("info").innerHTML = `
            <strong>Position actuelle :</strong> ${userLat.toFixed(5)}<br>
            <strong>Aucun prochain point de passage.</strong>
        `;
    }
}


// Fonction pour gérer les erreurs de géolocalisation
function showError(error) {
    switch(error.code) {
        case error.PERMISSION_DENIED:
            document.getElementById("info").innerText = "L'utilisateur a refusé la demande de géolocalisation.";
            break;
        case error.POSITION_UNAVAILABLE:
            document.getElementById("info").innerText = "Les informations de localisation ne sont pas disponibles.";
            break;
        case error.TIMEOUT:
            document.getElementById("info").innerText = "La demande de géolocalisation a expiré.";
            break;
        case error.UNKNOWN_ERROR:
            document.getElementById("info").innerText = "Une erreur inconnue s'est produite.";
            break;
    }
}

// Fonction pour calculer la distance entre deux points GPS (formule de Haversine)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance en km
}
