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
    passedPointMarkers: [],

    // Corridor PK ferroviaire (enrichissement optionnel — voir js/linearref.js).
    // null tant que data/datasets/rail-pk.json + son CSV ne sont pas branchés.
    railCorridor: null,
    railCorridorIndex: null,

    // Vitesse limite de ligne au PK courant (km/h) : null si corridor absent,
    // position hors corridor ou vitesse inconnue au point matché.
    currentVmax: null,

    // Ticks consécutifs où l'écart au corridor dépasse le seuil d'alerte
    // (voir trackCorridorOffset dans tracking.js)
    corridorOffsetStreak: 0
};

// --- Persistance de session du tracking rail ---
// iOS évince fréquemment l'app en arrière-plan : sans snapshot, la dernière
// position de confiance repart de zéro au rechargement et le garde-fou
// anti-téléportation est désarmé pour le premier fix, qui ancre alors le
// segment (un positionnement cellulaire aberrant au réveil serait accepté).
// Avec le snapshot, ce fix est confronté à la dernière position connue.
// Le TTL évite de ré-ancrer sur la position d'un trajet précédent. La clé est
// propre au mode rail : car.html partage la même origine donc le même stockage.
const TRACKING_SNAPSHOT_KEY = 'railTrackingSnapshot';
export const TRACKING_SNAPSHOT_MAX_AGE_MS = 10 * 60_000;

/**
 * Valide un snapshot sérialisé (fonction pure, testable sans localStorage).
 * @param {string|null} json - contenu brut du stockage
 * @param {number} nowTs
 * @param {number} [maxAgeMs]
 * @returns {{ lastTrustedPosition: {lat:number, lon:number, ts:number},
 *             railCorridorIndex: number|null } | null} null si absent/périmé/corrompu
 */
export function parseTrackingSnapshot(json, nowTs, maxAgeMs = TRACKING_SNAPSHOT_MAX_AGE_MS) {
    if (!json) return null;
    let raw;
    try {
        raw = JSON.parse(json);
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    if (!Number.isFinite(raw.savedAt) || raw.savedAt > nowTs || nowTs - raw.savedAt > maxAgeMs) return null;

    const pos = raw.lastTrustedPosition;
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon) || !Number.isFinite(pos.ts)) return null;
    if (Math.abs(pos.lat) > 90 || Math.abs(pos.lon) > 180 || pos.ts > nowTs) return null;

    const idx = raw.railCorridorIndex;
    return {
        lastTrustedPosition: { lat: pos.lat, lon: pos.lon, ts: pos.ts },
        railCorridorIndex: Number.isInteger(idx) && idx >= 0 ? idx : null
    };
}

export function saveTrackingSnapshot(nowTs = Date.now(), storage = globalThis.localStorage) {
    if (!STATE.lastTrustedPosition) return;
    try {
        storage.setItem(TRACKING_SNAPSHOT_KEY, JSON.stringify({
            lastTrustedPosition: STATE.lastTrustedPosition,
            railCorridorIndex: STATE.railCorridorIndex,
            savedAt: nowTs
        }));
    } catch (e) {
        // Stockage saturé ou indisponible : la persistance est un confort,
        // jamais bloquante pour le tracking.
    }
}

/**
 * Ré-injecte dans STATE le dernier snapshot valide. Un snapshot périmé ou
 * corrompu est supprimé : il contient une position, inutile de la garder.
 * L'index de corridor restauré n'est pas validé ici : le corridor se
 * charge de façon asynchrone, et le matcher retombe de lui-même sur une
 * recherche complète si l'index ne correspond plus à la position.
 * @returns {boolean} true si une session a été restaurée
 */
export function restoreTrackingSnapshot(nowTs = Date.now(), storage = globalThis.localStorage) {
    try {
        const json = storage.getItem(TRACKING_SNAPSHOT_KEY);
        const snapshot = parseTrackingSnapshot(json, nowTs);
        if (!snapshot) {
            if (json) storage.removeItem(TRACKING_SNAPSHOT_KEY);
            return false;
        }
        STATE.lastTrustedPosition = snapshot.lastTrustedPosition;
        if (snapshot.railCorridorIndex !== null) {
            STATE.railCorridorIndex = snapshot.railCorridorIndex;
        }
        return true;
    } catch (e) {
        return false;
    }
}

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
