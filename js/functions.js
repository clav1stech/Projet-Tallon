let pointsDePassage = [];

fetch('data/points.json')
    .then(response => response.json())
    .then(data => {
        pointsDePassage = data;
    })
    .catch(error => console.error('Erreur lors du chargement des points de passage:', error));

let departureTime;
let timelineElement = document.getElementById("timeline");
let trackingInterval = null;  // Variable pour stocker l'intervalle

// Fonction pour calculer l'heure d'arrivée avec retard
function calculateArrivalTime(startTime, duration, delay = 0) {
    const [hours, minutes] = startTime.split(':');
    const startDate = new Date();
    startDate.setHours(parseInt(hours));
    startDate.setMinutes(parseInt(minutes));
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);

    // Ajouter la durée (en secondes) et le retard (en minutes convertis en secondes)
    startDate.setSeconds(startDate.getSeconds() + duration + (delay * 60));
    return startDate;
}

// Fonction pour afficher la timeline avec les heures d'arrivée prévues
function displayTimeline() {
    timelineElement.innerHTML = `
        <div class="station header">
            <span>Heure</span>
            <span>PK</span>
            <span>Point de Passage</span>
            <span>Retard (min)</span>
        </div>
    `;
    let [hours, minutes] = departureTime.split(':').map(Number);
    let currentDate = new Date();
    currentDate.setHours(hours);
    currentDate.setMinutes(minutes);
    currentDate.setSeconds(0);
    currentDate.setMilliseconds(0);

    pointsDePassage.forEach((point, index) => {
        // Calculer le retard cumulé
        const cumulativeDelay = pointsDePassage.slice(0, index + 1).reduce((acc, p) => acc + (p.delay || 0), 0);
        const arrivalTime = calculateArrivalTime(departureTime, point.duree, cumulativeDelay);
        const arrivalTimeStr = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Vérification si c'est une gare
        let pointName = gares.includes(point.name) ? `<strong>${point.name}</strong>` : point.name;

        // Ajouter chaque point à la timeline avec le PK formaté
        const stationDiv = document.createElement("div");
        stationDiv.classList.add("station");
        if (point.delay && point.delay > 0) {
            stationDiv.classList.add("delayed");
        }
        stationDiv.innerHTML = `
            <span>${arrivalTimeStr}</span> 
            <span>${point.PK.toFixed(3)}</span> 
            <span>${pointName}</span>
            <span>
                <input type="number" min="0" value="${point.delay || 0}" onchange="updateDelay(${index}, this.value)">
            </span>
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

// Gérer l'affichage des champs manuels lorsque l'utilisateur sélectionne la méthode
document.querySelectorAll('input[name="locationMethod"]').forEach((radio) => {
    radio.addEventListener('change', function () {
        if (this.value === 'manual') {
            document.getElementById('manualCoords').style.display = 'block';
        } else {
            document.getElementById('manualCoords').style.display = 'none';
        }
    });
});

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

        if (!isNaN(manualLat) && !isNaN(manualLon) && manualLat >= -90 && manualLat <= 90 && manualLon >= -180 && manualLon <= 180) {
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

// Fonction pour afficher la position et mettre à jour l'avancement
function showPosition(position) {
    const userLat = position.coords.latitude;
    const userLon = position.coords.longitude;

    // Trouver le point de passage le plus proche
    let nearestPoint = null;
    let minDistance = Infinity;
    pointsDePassage.forEach(point => {
        const distance = haversineDistance(userLat, userLon, point.lat, point.lon);
        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = point;
        }
    });

    if (!nearestPoint) {
        document.getElementById("info").innerText = "Aucun point de passage trouvé.";
        return;
    }

    // Déterminer le prochain point de passage
    let nextPoint = null;
    for (let point of pointsDePassage) {
        if (point.PK > nearestPoint.PK) {
            nextPoint = point;
            break;
        }
    }

    // Retirer la classe 'current-station' de toutes les stations
    Array.from(timelineElement.children).forEach(station => {
        station.classList.remove("current-station");
    });

    // Ajouter la classe 'current-station' à la station la plus proche
    Array.from(timelineElement.children).forEach(station => {
        if (station.textContent.includes(nearestPoint.name)) {
            station.classList.add("current-station");
        }
    });

    // Affichage de la position et du prochain point de passage avec la distance
    if (nextPoint) {
        document.getElementById("info").innerHTML = `
            <strong>Position actuelle :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>
            <strong>Prochain point de passage :</strong> ${nextPoint.name} (PK: ${nextPoint.PK.toFixed(3)})<br>
            <strong>Distance restante :</strong> ${minDistance.toFixed(2)} km
        `;
    } else {
        document.getElementById("info").innerHTML = `
            <strong>Position actuelle :</strong> ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>
            <strong>Aucun prochain point de passage.</strong><br>
            <strong>Distance restante :</strong> ${minDistance.toFixed(2)} km
        `;
    }
}

// Fonction pour mettre à jour le retard
function updateDelay(index, value) {
    pointsDePassage[index].delay = parseInt(value) || 0;
    displayTimeline();
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
