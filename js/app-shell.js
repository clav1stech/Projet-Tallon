// js/app-shell.js
// Coquille DOM commune aux pages train et voiture : aides de rendu, bandeau
// d'information, détection iPhone et commande de changement de mode.

import { APP_MODES, LAST_MODE_STORAGE_KEY, otherMode } from './app-mode.js';

export const el = id => document.getElementById(id);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** N'écrit que si le texte change : pas de réannonce ni de recalcul de style inutile. */
export const setText = (id, text) => { const node = el(id); if (node && node.textContent !== String(text)) node.textContent = text; };
export const kmText = km => Number.isFinite(km) ? km.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—';

// La détection ne peut pas reposer sur le seul user-agent : dans une WebView
// hôte (Scriptable), l'UA peut ne pas contenir « iPhone », ce qui basculerait
// la page sur la mise en page non-iPhone. navigator.platform reste fiable dans
// WebKit quel que soit l'UA.
export function isIPhoneDevice() {
    if (typeof navigator === 'undefined') return false;
    if (/iPhone|iPod/i.test(navigator.userAgent || '')) return true;
    return navigator.platform === 'iPhone' || navigator.platform === 'iPod touch';
}

export function markDeviceClass() {
    document.body.classList.toggle('iphone-device', isIPhoneDevice());
    document.body.classList.toggle('non-iphone-device', !isIPhoneDevice());
}

let infoTimer;
let lastInfo = '';
/** Bandeau transitoire (#info). Un message identique au précédent n'est pas réannoncé. */
export function showInfo(message, displayMs) {
    if (message === lastInfo) return;
    lastInfo = message;
    const node = el('info');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => { node.hidden = true; }, displayMs);
}

/** Libellés des actions de l'accueil (modes de session-flow.js). */
export function renderHomeActionButtons(action) {
    setText('start-btn', { launch: 'Lancer le suivi →', apply: 'Appliquer et reprendre →', resume: 'Reprendre le suivi →' }[action.mode]);
    el('start-btn').disabled = !action.enabled;
    el('start-btn').dataset.mode = action.mode;
    el('secondary-btn').hidden = !action.secondary;
    setText('secondary-btn', { cancel: 'Annuler les modifications', end: 'Terminer' }[action.secondary] || '');
}

/** Fermeture des dialogues par leurs boutons `data-close-dialog`. */
export function bindDialogCloseButtons() {
    document.querySelectorAll('[data-close-dialog]').forEach(button => {
        button.addEventListener('click', () => button.closest('dialog').close());
    });
}

/**
 * Branche le lien de changement de mode (#mode-switch) et son dialogue de
 * confirmation (#mode-switch-dialog).
 *
 * Sans session, le lien navigue directement. Avec une session active, quitter
 * la page la termine (ses acquisitions ne valent que pour ce trajet et rien ne
 * tourne en arrière-plan) : l'utilisateur confirme, `endSession` arrête
 * proprement la localisation, puis la navigation a lieu. Les réglages restent
 * mémorisés de chaque côté.
 *
 * @param {object} options
 * @param {'train'|'car'} options.mode - mode de la page courante
 * @param {() => boolean} options.isSessionActive
 * @param {() => void} options.endSession
 */
export function initModeSwitch({ mode, isSessionActive, endSession }) {
    const link = el('mode-switch');
    const dialog = el('mode-switch-dialog');
    const target = APP_MODES[otherMode(mode)];
    link.href = target.url;
    // Sans entrée d'historique : le geste retour (conteneur iOS) ramènerait
    // sinon sur l'autre mode sans confirmation, voire sur une session gelée.
    const leave = () => window.location.replace(target.url);
    link.addEventListener('click', event => {
        event.preventDefault();
        if (isSessionActive()) dialog.showModal();
        else leave();
    });
    el('confirm-mode-switch-btn').addEventListener('click', () => {
        dialog.close();
        endSession();
        leave();
    });
    // Retour arrière (geste iOS) sur une page restaurée du cache : elle
    // redevient le mode courant.
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        try { localStorage.setItem(LAST_MODE_STORAGE_KEY, mode); } catch { /* stockage indisponible */ }
    });
}
