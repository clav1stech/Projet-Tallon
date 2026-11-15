// js/carousel-view.js
// Carrousel vertical commun aux cockpits train et voiture : ligne du parcours,
// tête de lecture interpolée entre deux repères, suivi automatique suspendu
// dès que l'utilisateur fait défiler, recentrage à la demande.
//
// Le contenu des repères (horaires du train, distances et ouvrages de la
// voiture) reste rendu par chaque mode : ce module ne connaît que la géométrie.

/**
 * @param {object} options
 * @param {HTMLElement} options.carousel - conteneur défilant
 * @param {HTMLElement} options.points - liste des repères, porte les variables CSS
 *   `--line-top`, `--line-height`, `--cursor-top` et l'élément `.train-cursor`
 * @param {HTMLElement} options.recenterButton
 * @param {number} options.heroRatio - hauteur relative où se place le repère visé
 * @param {number} options.animationMs
 */
export function createCarouselView({ carousel, points, recenterButton, heroRatio, animationMs }) {
    let following = true;
    let scrollFrame = null;
    let lastPosition = null;

    function cancelScroll() {
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
    }

    /**
     * @param {{index:number, ratio:number, located:boolean}|null} position -
     *   dernier repère franchi, avancement 0→1 vers le suivant, et présence
     *   d'une position à montrer (sinon la tête de lecture est masquée)
     * @param {boolean} animate - défilement animé vers le repère visé
     */
    function layout(position = lastPosition, animate = false) {
        lastPosition = position;
        if (!position || !carousel.clientHeight) return;
        const all = points.querySelectorAll('.train-point');
        const first = all[0];
        if (!first) return;
        const y = node => node.offsetTop + node.offsetHeight / 2;
        points.style.setProperty('--line-top', `${y(first)}px`);
        points.style.setProperty('--line-height', `${y(all[all.length - 1]) - y(first)}px`);
        const from = all[position.index];
        const to = all[position.index + 1];
        points.style.setProperty('--cursor-top', `${from ? y(from) + (to ? (y(to) - y(from)) * position.ratio : 0) : y(first)}px`);
        points.querySelector('.train-cursor').hidden = !position.located;
        if (!following) return;
        const target = to || from || first;
        const top = Math.max(0, y(target) - carousel.clientHeight * heroRatio);
        cancelScroll();
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!animate || reducedMotion) { carousel.scrollTop = top; return; }
        const start = carousel.scrollTop;
        const startTime = performance.now();
        const step = now => {
            const t = Math.min(1, (now - startTime) / animationMs);
            carousel.scrollTop = start + (top - start) * (1 - (1 - t) ** 3);
            scrollFrame = t < 1 ? requestAnimationFrame(step) : null;
        };
        scrollFrame = requestAnimationFrame(step);
    }

    return {
        layout,
        cancelScroll,
        /** Consultation libre : un tick ordinaire ne reprend jamais la main. */
        pause() {
            following = false;
            recenterButton.hidden = false;
            cancelScroll();
        },
        recenter() {
            following = true;
            recenterButton.hidden = true;
            layout(lastPosition, true);
        },
        /** Nouvelle session : suivi automatique rétabli, sans défilement. */
        reset() {
            following = true;
            recenterButton.hidden = true;
        }
    };
}

/**
 * Écouteurs de consultation manuelle (toucher, souris, clavier) et de
 * recentrage d'un carrousel.
 */
export function bindCarouselInteractions(carousel, recenterButton, view) {
    ['wheel', 'touchstart', 'pointerdown'].forEach(type => carousel.addEventListener(type, view.pause, { passive: true }));
    carousel.addEventListener('keydown', event => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) view.pause();
    });
    recenterButton.addEventListener('click', () => {
        view.recenter();
        carousel.focus({ preventScroll: true });
    });
}
