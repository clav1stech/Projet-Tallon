// js/state.js
export const STATE = {
    // Horaire de départ saisi (HH:MM)
    departureTime: null,

    // Sens courant (ex: 'SUD' / 'NORD' ou équivalent)
    direction: 'north-south',

    // --- NOUVELLE SOURCE DE VÉRITÉ DES ROUTES ---
    // Contenu de data/masterRoutes.json
    masterRoutes: [],

    // Contenu de data/servicePatterns.json
    servicePatterns: [],

    // Route courante "dépliée" pour le pattern sélectionné
    // (remplace progressivement pointsDePassage comme source principale)
    currentRoute: [],

    // Sélection de trajet principal (Paris -> destination) + arrêts intermédiaires
    selectedMainRouteKey: '',
    selectedStopIds: [],

    // Id du pattern courant (clé vers servicePatterns)
    selectedPatternId: '',

    // Timestamp de départ effectif (ms depuis epoch) si calculé
    departureTimestamp: null,

    // Décalage global appliqué aux durées (pour intégration ultérieure)
    globalDeltaSeconds: 0,

    // Délai par point : { [pointId]: delayEnMs }
    passedPoints: {},

    // Dernier index de segment utilisé pour le tracking
    lastSegmentIndex: null,

    // --- ANCIENS CHAMPS (UTILISÉS / TRANSITOIRES) ---
    // Ancienne liste des points ; va être progressivement remplacée par currentRoute.
    pointsDePassage: [],

    // Ancien identifiant de route (ne plus utiliser comme source principale)
    selectedRoute: '',

    // Méthode de localisation
    locationMethod: 'geo',
    manualLat: null,
    manualLon: null,
    lastScrolledStationIdx: null,

    // Champ trajets neutralisé : ne plus dépendre de la globale `trajets`
    trajets: [],

    // Historique des dernières positions GPS pour le calcul de vitesse lissée
    lastPositions: []
};

export function restoreSettings() {
    try {
        const storedPatternId = localStorage.getItem('selectedPatternId');
        const storedDepartureTime = localStorage.getItem('departureTime');
        const storedLocationMethod = localStorage.getItem('locationMethod');
        const storedManualLat = localStorage.getItem('manualLat');
        const storedManualLon = localStorage.getItem('manualLon');
        const storedGlobalDelta = localStorage.getItem('globalDeltaSeconds');
        const storedMainRouteKey = localStorage.getItem('selectedMainRouteKey');
        const storedStopIds = localStorage.getItem('selectedStopIds');

        STATE.selectedPatternId = storedPatternId || '';
        STATE.departureTime = storedDepartureTime || '';
        STATE.locationMethod = storedLocationMethod || 'geo';
        STATE.manualLat = storedManualLat || '';
        STATE.manualLon = storedManualLon || '';
        STATE.selectedMainRouteKey = storedMainRouteKey || '';
        STATE.selectedStopIds = storedStopIds ? storedStopIds.split(',').filter(Boolean) : [];

        // ✅ Restaure le ΔT global (en secondes)
        if (storedGlobalDelta !== null && !Number.isNaN(Number(storedGlobalDelta))) {
            STATE.globalDeltaSeconds = Number(storedGlobalDelta);
        } else {
            STATE.globalDeltaSeconds = 0;
        }

        // Initialisation par défaut de champs dérivés
        STATE.masterRoutes = STATE.masterRoutes || [];
        STATE.servicePatterns = STATE.servicePatterns || [];
        STATE.currentRoute = STATE.currentRoute || [];
        STATE.departureTimestamp = null;
        STATE.passedPoints = {};
        STATE.lastSegmentIndex = null;
        STATE.currentDelay = 0;
    } catch (e) {
        console.error('Erreur lors de la restauration des paramètres :', e);
    }
}

export function saveSettings() {
    try {
        localStorage.setItem('selectedPatternId', STATE.selectedPatternId || '');
        localStorage.setItem('departureTime', STATE.departureTime || '');
        localStorage.setItem('locationMethod', STATE.locationMethod || 'geo');
        localStorage.setItem('manualLat', STATE.manualLat || '');
        localStorage.setItem('manualLon', STATE.manualLon || '');

        // ✅ Sauvegarde du ΔT global
        localStorage.setItem('globalDeltaSeconds', String(STATE.globalDeltaSeconds || 0));

        // Nouveau sélecteur principal et arrêts intermédiaires
        localStorage.setItem('selectedMainRouteKey', STATE.selectedMainRouteKey || '');
        localStorage.setItem('selectedStopIds', (STATE.selectedStopIds || []).join(','));
    } catch (e) {
        console.error('Erreur lors de la sauvegarde des paramètres :', e);
    }
}
