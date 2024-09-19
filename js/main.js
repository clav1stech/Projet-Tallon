// js/main.js

let departureTime;
let timelineElement = document.getElementById("timeline");
let trackingInterval = null;  // Variable pour stocker l'intervalle

// Fonction pour calculer l'heure d'arrivée
function calculateArrivalTime(startTime, duration, retard = 0) {
    const [hours, minutes] = startTime.split(':');
    const startDate = new Date();
    startDate.setHours(parseInt(hours));
    startDate.setMinutes(parseInt(minutes));
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);

    // Ajouter la durée (en secondes) et le retard (en minutes convertis en secondes)
    startDate.setSeconds(startDate.getSeconds() + duration + retard * 60);
    return startDate;
}

// Fonction pour afficher la timeline avec les heures d'arrivée prévues
function displayTimeline() {
    timelineElement.innerHTML = `
        <div class="station header">
            <span>Heure</span>
            <span>PK</span>
            <span>Nom du Point</span>
        </div>
    `;
    let [hours, minutes] = departureTime.split(':').map(Number);
    let currentDate = new Date();
    currentDate.setHours(hours);
    currentDate.setMinutes(minutes);
    currentDate.setSeconds(0);
    currentDate.setMilliseconds(0);

    pointsDePassage.forEach((point, index) => {
        const arrivalTime = calculateArrivalTime(departureTime, point.duree, point.retard);
        const arrivalTimeStr = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Vérification si c'est une gare
        const gares = ["Paris-Lyon", "Valence TGV", "Avignon TGV", "Lyon-Saint-Exupéry TGV", "Marseille Saint-Charles", "Macon – Loché TGV", "Le Creusot – Montceau – Montchanin TGV", "Aix-en-Provence TGV"];
        let pointName = gares.includes(point.name) ? `<strong>${point.name}</strong>` : point.name;

        // Appliquer la classe 'delayed' si retard > 0
        const delayedClass = point.retard > 0 ? 'delayed' : '';

        // Ajouter chaque point à la timeline avec le PK formaté
        const stationDiv = document.createElement("div");
        stationDiv.classList.add("station");
        if (point.retard > 0) {
            stationDiv.classList.add('delayed');
        }
        stationDiv.innerHTML = `
            <span>${arrivalTimeStr}</span>
            <span>${point.PK.toFixed(3)}</span>
            <span>${pointName}</span>
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

    // Déterminer les points passés et à venir
    const passedPoints = pointsDePassage.filter(point => point.PK < nearestPoint.PK);
    const upcomingPoints = pointsDePassage.filter(point => point.PK >= nearestPoint.PK);

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

    // Déterminer le prochain point de passage (le premier dans upcomingPoints après nearestPoint)
    let nextPoint = null;
    for (let point of pointsDePassage) {
        if (point.PK > nearestPoint.PK) {
            nextPoint = point;
            break;
        }
    }

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
