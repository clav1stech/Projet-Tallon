// js/hud-cursor.js
// Tête de lecture du carousel HUD — seul morceau de rendu partagé entre le
// HUD rail (ui.js) et le HUD voiture (car-ui.js), les deux carousels ayant
// la même géométrie de ligne verticale et de nœuds.
//
// La position ne peut pas être décrite en CSS seul : elle s'interpole entre
// les centres de deux `.hud-point` dont la hauteur change pendant les 700 ms
// de transition qui suivent un changement de point actif. D'où un simple
// écrivain de variable CSS, appelé aussi bien au tick GPS que dans la boucle
// d'animation de scroll des deux HUD.

/**
 * Positionne la tête de lecture entre deux points du carousel.
 * @param {HTMLElement} trackPoints - conteneur #hud-track-points
 * @param {number} fromIdx - data-idx du point déjà franchi
 * @param {number} toIdx   - data-idx du point visé
 * @param {number} ratio   - avancement 0 → 1 entre les deux (borné ici)
 * @returns {boolean} true si la tête est visible
 */
export function updateHudCursor(trackPoints, fromIdx, toIdx, ratio) {
    if (!trackPoints) return false;
    const cursor = trackPoints.querySelector('.hud-cursor');
    if (!cursor) return false;

    const from = trackPoints.querySelector(`.hud-point[data-idx="${fromIdx}"]`);
    const to = trackPoints.querySelector(`.hud-point[data-idx="${toIdx}"]`);
    // Avant le premier point comme après le terminus, il n'y a pas de couple
    // à interpoler : la tête n'a alors aucune position honnête à afficher.
    if (!from || !to) {
        cursor.classList.add('hidden');
        return false;
    }

    const fromY = from.offsetTop + from.offsetHeight / 2;
    const toY = to.offsetTop + to.offsetHeight / 2;
    const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    trackPoints.style.setProperty('--cursor-top', `${fromY + safeRatio * (toY - fromY)}px`);
    cursor.classList.remove('hidden');
    return true;
}

/** Crée la tête de lecture si le carousel n'en a pas encore (rebuild complet). */
export function ensureHudCursor(trackPoints) {
    if (!trackPoints) return null;
    let cursor = trackPoints.querySelector('.hud-cursor');
    if (!cursor) {
        cursor = document.createElement('div');
        cursor.className = 'hud-cursor hidden';
        cursor.setAttribute('aria-hidden', 'true');
        trackPoints.appendChild(cursor);
    }
    return cursor;
}

/**
 * Interpolation verticale entre deux éléments d'une liste, dans le même
 * référentiel que la tête de lecture. Partagée avec le liseré de la timeline
 * portrait, qui suit la même progression sur une autre géométrie.
 * @returns {number|null} ordonnée en px, ou null si le couple est incomplet
 */
export function interpolateElementY(fromEl, toEl, ratio) {
    if (!fromEl) return null;
    const fromY = fromEl.offsetTop + fromEl.offsetHeight / 2;
    if (!toEl) return fromY;
    const toY = toEl.offsetTop + toEl.offsetHeight / 2;
    const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    return fromY + safeRatio * (toY - fromY);
}
