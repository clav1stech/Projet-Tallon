// js/geo.js
import STATE from './state.js';

// Haversine distance en km
export function haversineDistance(lat1, lon1, lat2, lon2) {
    function toRad(deg) { return deg * Math.PI / 180; }
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

export function geoErrorMessage(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED: return "L'utilisateur a refusé la demande de géolocalisation.";
        case error.POSITION_UNAVAILABLE: return "Les informations de localisation ne sont pas disponibles.";
        case error.TIMEOUT: return "La requête de géolocalisation a expiré.";
        default: return "Une erreur inconnue s'est produite.";
    }
}
