// js/train-controller.js
// Transitions d'état du mode train, sans DOM ni horloge implicite. C'est le
// seul endroit où navigation, configuration provisoire, configuration
// appliquée et session se rencontrent — et où leurs frontières sont tenues :
//
//   showView()      navigation seule
//   setDraft()      configuration provisoire seule
//   launchSession() provisoire → appliquée, démarre la session
//   applyDraft()    provisoire → appliquée, session conservée et rejouée
//   revertDraft()   appliquée → provisoire (abandon des modifications)
//   stopSession()   clôt la session
//
// La boucle d'acquisition (intervalle, écouteurs) vit dans app.js : elle est
// créée au lancement et détruite à la clôture, jamais ailleurs.

import { buildTripPlan, createTripConfig, diffTripConfig } from './trip-config.js';
import { clearTripPlan, endSession, installTripPlan, replaySession, startSession } from './tracking-session.js';

const dataOf = (state) => ({ points: state.points, trajets: state.trajets });

/**
 * Modifie la configuration provisoire. Changer de liaison vide la sélection
 * d'arrêts (ils n'ont de sens que pour une liaison donnée), sauf si le patch
 * la fournit.
 */
export function setDraft(state, patch) {
    const next = { ...state.draftConfig, ...patch };
    if ('mainRouteKey' in patch && patch.mainRouteKey !== state.draftConfig.mainRouteKey && !('stopIds' in patch)) {
        next.stopIds = [];
    }
    state.draftConfig = createTripConfig(next);
    return state.draftConfig;
}

/** Plan correspondant à la configuration provisoire (aperçu de l'accueil). */
export function buildDraftPlan(state, nowTs = Date.now()) {
    return buildTripPlan(state.draftConfig, dataOf(state), state.session.active ? state.session.startedAt : nowTs);
}

export function isDraftDirty(state) {
    return !!state.appliedConfig && diffTripConfig(state.appliedConfig, state.draftConfig).any;
}

/**
 * Action principale de l'accueil, selon l'état :
 *  - 'launch' : pas de session ; activable si la configuration est valide ;
 *  - 'apply'  : session active et configuration modifiée ;
 *  - 'resume' : session active, rien à appliquer — toujours activable.
 * `secondary` : 'cancel' (abandonner les modifications), 'end' (terminer la
 * session) ou null. `status` reprend celui du plan provisoire.
 */
export function getHomeAction(state, nowTs = Date.now()) {
    const status = buildDraftPlan(state, nowTs).status;
    if (!state.session.active) return { mode: 'launch', enabled: status === 'ok', secondary: null, status };
    if (isDraftDirty(state)) return { mode: 'apply', enabled: status === 'ok', secondary: 'cancel', status };
    return { mode: 'resume', enabled: true, secondary: 'end', status };
}

/** Change de vue. Le suivi n'est affichable que pendant une session. */
export function showView(state, view) {
    state.view = view === 'tracking' && state.session.active ? 'tracking' : 'home';
    return state.view;
}

/**
 * Démarre une session sur la configuration provisoire.
 * @returns {{ok:true}|{ok:false, reason:string}} reason = statut du plan, ou
 *   'already-active' (un second lancement ne réinitialise jamais la session)
 */
export function launchSession(state, nowTs = Date.now()) {
    if (state.session.active) return { ok: false, reason: 'already-active' };
    const plan = buildTripPlan(state.draftConfig, dataOf(state), nowTs);
    if (plan.status !== 'ok') return { ok: false, reason: plan.status };

    startSession(state, nowTs);
    installTripPlan(state, plan);
    state.appliedConfig = plan.config;
    state.draftConfig = { ...plan.config, stopIds: [...plan.config.stopIds] };
    state.locationMethod = plan.config.locationMethod;
    state.view = 'tracking';
    return { ok: true };
}

/**
 * Applique la configuration provisoire à la session en cours.
 *
 * Rien n'est modifié si le plan est invalide. Sinon le nouveau plan est
 * installé et, s'il change le trajet ou ses horaires, les résultats dérivés
 * sont rejoués depuis l'historique brut. L'historique, les garde-fous
 * d'acquisition et la boucle de localisation ne sont jamais touchés.
 *
 * Le jour de départ reste rattaché au lancement de la session : réappliquer
 * après minuit ne décale pas l'horaire d'un jour.
 *
 * @returns {{ok:true, change:'none'|'source'|'schedule'|'route'}|{ok:false, reason:string}}
 */
export function applyDraft(state) {
    if (!state.session.active) return { ok: false, reason: 'no-session' };
    const diff = diffTripConfig(state.appliedConfig, state.draftConfig);
    if (diff.schedule) {
        const plan = buildTripPlan(state.draftConfig, dataOf(state), state.session.startedAt);
        if (plan.status !== 'ok') return { ok: false, reason: plan.status };
        installTripPlan(state, plan);
        replaySession(state);
    }
    state.appliedConfig = createTripConfig(state.draftConfig);
    if (diff.source) state.locationMethod = state.appliedConfig.locationMethod;
    state.view = 'tracking';
    return { ok: true, change: diff.route ? 'route' : (diff.schedule ? 'schedule' : (diff.source ? 'source' : 'none')) };
}

/** Abandonne les modifications : le formulaire reprend la configuration suivie. */
export function revertDraft(state) {
    if (state.appliedConfig) {
        state.draftConfig = { ...state.appliedConfig, stopIds: [...state.appliedConfig.stopIds] };
    }
    return state.draftConfig;
}

/**
 * Une source de localisation qui s'impose d'elle-même (bridge Scriptable)
 * vaut pour la session comme pour les deux configurations : elle ne doit pas
 * apparaître comme une modification à appliquer.
 */
export function adoptLocationMethod(state, method) {
    state.locationMethod = method;
    state.draftConfig = { ...state.draftConfig, locationMethod: method };
    if (state.appliedConfig) state.appliedConfig = { ...state.appliedConfig, locationMethod: method };
}

/** Clôt la session : historique et dérivés effacés, formulaire conservé. */
export function stopSession(state) {
    endSession(state);
    clearTripPlan(state);
    state.appliedConfig = null;
    state.view = 'home';
}
