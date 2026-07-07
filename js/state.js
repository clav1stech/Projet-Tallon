// js/state.js
export const STATE = {
    // Horaire de départ saisi (HH:MM)
    departureTime: null,

    // Sens courant (ex: 'SUD' / 'NORD' ou équivalent)
    direction: 'north-south',

    // Dictionnaire global des points — chargé depuis data/masterRoutes.normalized.json
    points: {},

    // Tableau des trajets (schéma v3) — chargé depuis data/masterRoutes.normalized.json
    // (remplace masterRoutes)

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

    // Méthode de localisation (auto-détectée au démarrage)
    locationMethod: 'geo',
    lastScrolledStationIdx: null,

    trajets: [],

    // Historique des dernières positions GPS pour le calcul de vitesse lissée
    lastPositions: [],

    // Timestamp du dernier appel GPS reçu (ms depuis epoch)
    lastGpsUpdateMs: 0,

    // Fiabilité GPS : dernière position validée + flag de récupération post-téléportation
    lastTrustedPosition: null,   // { lat, lon, ts }
    gpsRecoveryMode: false,

    // Compteur de rejets anti-téléportation consécutifs (récupération après N rejets)
    teleportRejections: 0,

    // Timestamp du dernier fix GPS accepté (filtre de précision / mode dégradé)
    lastAcceptedFixMs: 0,

    // Historique de vitesse pour le sparkline (max 1800 points = 30 min à 1 pt/s)
    // Chaque entrée : { v: number, reliable: boolean }
    speedHistory: [],

    // Timestamps de passage des points pour les marqueurs sur le graphique
    passedPointMarkers: []
};

export function restoreSettings() {
    try {
        const storedPatternId = localStorage.getItem('selectedPatternId');
        const storedDepartureTime = localStorage.getItem('departureTime');
        const storedGlobalDelta = localStorage.getItem('globalDeltaSeconds');
        const storedMainRouteKey = localStorage.getItem('selectedMainRouteKey');
        const storedStopIds = localStorage.getItem('selectedStopIds');

        STATE.selectedPatternId = storedPatternId || '';
        STATE.departureTime = storedDepartureTime || '';
        STATE.selectedMainRouteKey = storedMainRouteKey || '';
        STATE.selectedStopIds = storedStopIds ? storedStopIds.split(',').filter(Boolean) : [];

        // ✅ Restaure le ΔT global (en secondes)
        if (storedGlobalDelta !== null && !Number.isNaN(Number(storedGlobalDelta))) {
            STATE.globalDeltaSeconds = Number(storedGlobalDelta);
        } else {
            STATE.globalDeltaSeconds = 0;
        }

        // Initialisation par défaut de champs dérivés
        STATE.points = STATE.points || {};
        STATE.trajets = STATE.trajets || [];
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

        // ✅ Sauvegarde du ΔT global
        localStorage.setItem('globalDeltaSeconds', String(STATE.globalDeltaSeconds || 0));

        // Nouveau sélecteur principal et arrêts intermédiaires
        localStorage.setItem('selectedMainRouteKey', STATE.selectedMainRouteKey || '');
        localStorage.setItem('selectedStopIds', (STATE.selectedStopIds || []).join(','));
    } catch (e) {
        console.error('Erreur lors de la sauvegarde des paramètres :', e);
    }
}
