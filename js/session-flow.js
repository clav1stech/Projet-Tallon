// js/session-flow.js
// Règles de cycle de session communes aux modes train et voiture, sans DOM ni
// état : chaque contrôleur (train-controller.js, car-session.js) y branche
// sa propre notion de configuration valide ou modifiée.

/**
 * Action principale de l'accueil :
 *  - 'launch' : pas de session ; activable si la configuration est valide ;
 *  - 'apply'  : session active et configuration modifiée ;
 *  - 'resume' : session active, rien à appliquer — toujours activable.
 * `secondary` : 'cancel' (abandonner les modifications), 'end' (terminer la
 * session) ou null.
 */
export function resolveHomeAction({ active, dirty, valid }) {
    if (!active) return { mode: 'launch', enabled: !!valid, secondary: null };
    if (dirty) return { mode: 'apply', enabled: !!valid, secondary: 'cancel' };
    return { mode: 'resume', enabled: true, secondary: 'end' };
}

/** Le suivi n'est affichable que pendant une session. */
export function resolveView(view, active) {
    return view === 'tracking' && active ? 'tracking' : 'home';
}
