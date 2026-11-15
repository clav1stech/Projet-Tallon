// js/app-mode.js
// Les deux modes de transport sont deux pages (index.html, car.html) : chacune
// garde son manifeste PWA, son état et ses préférences. Changer de mode est
// donc une navigation — l'ancienne page est déchargée, sa géolocalisation avec.
// Ce module ne touche pas au DOM (commande de bascule : app-shell.js).

export const APP_MODES = Object.freeze({
    train: { url: 'index.html', label: 'Train' },
    car: { url: 'car.html', label: 'Voiture' }
});

export const LAST_MODE_STORAGE_KEY = 'tallon.lastMode';
// Posé une fois par lancement de l'app (sessionStorage) : au-delà, l'arrivée
// sur une page est un choix de l'utilisateur, jamais redirigé.
export const LAUNCH_FLAG_STORAGE_KEY = 'tallon.launched';

export const otherMode = mode => (mode === 'car' ? 'train' : 'car');

/**
 * Page à ouvrir à la place de la page courante au lancement, ou null.
 *
 * Seul le conteneur iOS reprend le dernier mode utilisé : il n'a qu'une icône
 * et démarre toujours sur index.html. Sur le web, chaque PWA installée ouvre
 * le mode de son icône (`start_url` de son manifeste) et une URL saisie est
 * respectée telle quelle.
 */
export function resolveLaunchRedirect({ mode, lastMode, native, launched }) {
    if (!native || launched || !APP_MODES[lastMode] || lastMode === mode) return null;
    return APP_MODES[lastMode].url;
}

const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, value); } catch { /* stockage indisponible */ } };

/**
 * À appeler au chargement de la page d'un mode.
 * @returns {boolean} true si une redirection vers l'autre mode est engagée :
 *   la page ne doit alors rien démarrer.
 */
export function enterMode(mode, win = window) {
    const native = !!win.webkit?.messageHandlers?.tallonNative;
    const target = resolveLaunchRedirect({
        mode,
        lastMode: read(win.localStorage, LAST_MODE_STORAGE_KEY),
        native,
        launched: read(win.sessionStorage, LAUNCH_FLAG_STORAGE_KEY) === '1'
    });
    write(win.sessionStorage, LAUNCH_FLAG_STORAGE_KEY, '1');
    if (target) {
        win.location.replace(target);
        return true;
    }
    write(win.localStorage, LAST_MODE_STORAGE_KEY, mode);
    return false;
}
