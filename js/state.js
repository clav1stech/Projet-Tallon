// js/state.js
// État applicatif unique. Quatre familles à ne jamais confondre :
//
//  1. NAVIGATION            `view` — quelle vue est affichée. La changer ne
//                           touche à rien d'autre.
//  2. CONFIGURATION         `draftConfig` — ce que montre le formulaire de
//     PROVISOIRE            l'accueil. Sans effet sur le suivi tant qu'elle
//                           n'est pas appliquée.
//  3. CONFIGURATION         `appliedConfig`, `tripPlan` et leurs miroirs
//     APPLIQUÉE             (`currentRoute`, `departureTimestamp`…) — le
//                           trajet réellement suivi par la session.
//  4. SESSION DE TRACKING   `session` — acquisitions brutes et garde-fous,
//                           indépendants du trajet ; plus les résultats
//                           DÉRIVÉS (acquisitions × trajet appliqué), toujours
//                           recalculables par rejeu (`replaySession`).
//
// Seul js/train-controller.js fait transiter l'état d'une famille à l'autre.

/**
 * Session vierge. Les champs décrivent ce qui a été acquis, jamais le trajet :
 * ils survivent donc à toute reconfiguration.
 */
export function createSessionState() {
    return {
        active: false,
        startedAt: 0,

        // Historique intégral de la session, un élément par fix accepté ou par
        // tick sans signal : { ts, v, reliable } et, pour un fix,
        // { lat, lon, accuracyM, speedReliable, reseeded }. `routeKm` est une
        // annotation dérivée (position le long du trajet appliqué), réécrite
        // au rejeu.
        samples: [],

        // Dernières positions pour la vitesse médiane.
        lastPositions: [],
        // Réception du dernier fix, accepté ou non (détection de perte de signal).
        lastGpsUpdateMs: 0,
        // Anti-téléportation : dernière position validée, rejets consécutifs.
        lastTrustedPosition: null,   // { lat, lon, ts }
        teleportRejections: 0,
        gpsRecoveryMode: false,
        // Dernier fix accepté (mode dégradé du filtre de précision).
        lastAcceptedFixMs: 0
    };
}

export const STATE = {
    // --- Données de référence (data/masterRoutes.normalized.json, schéma v3) ---
    points: {},
    trajets: [],
    servicePatterns: [],

    // Corridor PK ferroviaire (enrichissement optionnel — voir js/linearref.js).
    // null tant que data/datasets/rail-pk.json + son CSV ne sont pas branchés.
    railCorridor: null,
    railCorridorIndex: null,

    // --- 1. Navigation ---
    view: 'home',   // 'home' | 'tracking'

    // --- 2. Configuration provisoire (forme : createTripConfig, trip-config.js) ---
    draftConfig: { mainRouteKey: '', stopIds: [], departureTime: '', globalDeltaSeconds: 0, locationMethod: 'geo' },

    // --- 3. Configuration appliquée et plan de trajet ---
    appliedConfig: null,
    tripPlan: null,
    // Incrémenté à chaque plan installé : clé de reconstruction des rendus.
    planRevision: 0,
    // Miroirs du plan appliqué, lus par le moteur, le rendu et fakeGeoSim.
    currentRoute: [],
    direction: 'SUD',
    selectedPatternId: '',
    departureTime: '',
    departureTimestamp: null,
    globalDeltaSeconds: 0,

    // --- 4. Session de tracking ---
    // Source de localisation active (peut diverger de la configuration : repli
    // GPS si le WiFi SNCF échoue, bridge Scriptable qui s'impose).
    locationMethod: 'geo',
    session: createSessionState(),

    // Dérivés du suivi (acquisitions × trajet appliqué).
    lastSegmentIndex: null,
    passageTimes: {},        // { [pointId]: timestamp de franchissement constaté }
    passedPoints: {},        // { [pointId]: écart en ms à l'horaire appliqué }
    passedPointMarkers: [],  // [{ pointId, name, ts }] dans l'ordre de franchissement
    currentDelay: 0,
    // Dernier état affichable : permet de redessiner le suivi sans nouveau fix
    // (retour des réglages, rotation).
    trackingSnapshot: null
};

/** Restaure les préférences de trajet dans la configuration provisoire. */
export function restoreSettings() {
    try {
        const storedGlobalDelta = localStorage.getItem('globalDeltaSeconds');
        const storedStopIds = localStorage.getItem('selectedStopIds');
        STATE.draftConfig = {
            mainRouteKey: localStorage.getItem('selectedMainRouteKey') || '',
            stopIds: storedStopIds ? storedStopIds.split(',').filter(Boolean) : [],
            departureTime: localStorage.getItem('departureTime') || '',
            globalDeltaSeconds: storedGlobalDelta !== null && !Number.isNaN(Number(storedGlobalDelta))
                ? Number(storedGlobalDelta)
                : 0,
            locationMethod: STATE.draftConfig.locationMethod
        };
    } catch (e) {
        console.error('Erreur lors de la restauration des paramètres :', e);
    }
}

/** Mémorise la configuration provisoire (préférences du prochain lancement). */
export function saveSettings() {
    try {
        const draft = STATE.draftConfig;
        localStorage.setItem('departureTime', draft.departureTime || '');
        localStorage.setItem('globalDeltaSeconds', String(draft.globalDeltaSeconds || 0));
        localStorage.setItem('selectedMainRouteKey', draft.mainRouteKey || '');
        localStorage.setItem('selectedStopIds', (draft.stopIds || []).join(','));
    } catch (e) {
        console.error('Erreur lors de la sauvegarde des paramètres :', e);
    }
}
