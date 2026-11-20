// js/editor-shell.js
// Coquille commune des éditeurs : barre de navigation entre les quatre pages,
// bandeau du brouillon local partagé et message d'état. Le trajet sélectionné
// suit la navigation (paramètre « route ») entre les pages qui le comprennent.

import { MASTER_ROUTES_DRAFT_KEY } from './master-routes-draft.js';

export const EDITOR_PAGES = [
    { id: 'routes', href: 'master-editor.html', label: 'Trajets', icon: 'fa-list-ol', carriesRoute: true },
    { id: 'profile', href: 'route-profile.html', label: 'Profil de vitesse', icon: 'fa-chart-line', carriesRoute: true },
    { id: 'rail-map', href: 'train-points-editor.html', label: 'Carte rail', icon: 'fa-train', carriesRoute: true },
    { id: 'car-map', href: 'car-points-editor.html', label: 'Carte voiture', icon: 'fa-car', carriesRoute: false }
];

const APP_LINKS = [
    { href: 'index.html', label: 'Appli train', icon: 'fa-train' },
    { href: 'car.html', label: 'Appli voiture', icon: 'fa-car-side' }
];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(name) {
    const node = element('i', `fas ${name}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

export function formatClock(timestamp) {
    return new Date(timestamp).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

/** Message d'état d'une page ; type : '', 'success', 'warning', 'error'. */
export function setStatus(target, message, type = '') {
    if (!target) return;
    target.textContent = message;
    target.dataset.type = type;
}

/** Paramètre d'URL de la page courante. */
export function readQueryParam(name) {
    return new URLSearchParams(location.search).get(name);
}

/**
 * Monte la barre de navigation dans #editor-shell.
 * @param {object} options
 * @param {string} options.active - identifiant de la page courante (EDITOR_PAGES)
 * @returns {object} commandes : setRouteKey, showDraft, hideDraft, onExternalDraftChange
 */
export function mountEditorShell({ active }) {
    const host = document.getElementById('editor-shell');
    const header = element('header', 'shell');
    const brand = element('a', 'shell-brand');
    brand.href = 'master-editor.html';
    brand.append(element('span', 'shell-logo', 'T'), element('span', 'shell-brand-text', 'Atelier Tallon'));

    const nav = element('nav', 'shell-nav');
    nav.setAttribute('aria-label', 'Éditeurs');
    const tabs = new Map();
    for (const page of EDITOR_PAGES) {
        const link = element('a', `shell-tab${page.id === active ? ' is-active' : ''}`);
        link.href = page.href;
        if (page.id === active) link.setAttribute('aria-current', 'page');
        link.append(icon(page.icon), element('span', '', page.label));
        tabs.set(page.id, link);
        nav.appendChild(link);
    }

    const apps = element('div', 'shell-apps');
    for (const app of APP_LINKS) {
        const link = element('a', 'shell-app-link');
        link.href = app.href;
        link.title = `Ouvrir l’${app.label.toLowerCase()}`;
        link.append(icon(app.icon), element('span', '', app.label));
        apps.appendChild(link);
    }
    header.append(brand, nav, apps);

    const draftBar = element('div', 'shell-draft');
    draftBar.hidden = true;
    draftBar.setAttribute('role', 'status');
    const draftText = element('span', 'shell-draft-text');
    const draftActions = element('span', 'shell-draft-actions');
    draftBar.append(icon('fa-pen-nib'), draftText, draftActions);

    host.replaceChildren(header, draftBar);
    tabs.get(active)?.scrollIntoView?.({ block: 'nearest', inline: 'center' });

    function setRouteKey(routeKey) {
        const url = new URL(location.href);
        if (routeKey) url.searchParams.set('route', routeKey);
        else url.searchParams.delete('route');
        url.searchParams.delete('seg');
        history.replaceState(null, '', url);
        for (const page of EDITOR_PAGES) {
            if (!page.carriesRoute || page.id === active) continue;
            tabs.get(page.id).href = routeKey ? `${page.href}?route=${encodeURIComponent(routeKey)}` : page.href;
        }
    }

    /**
     * @param {number} savedAt
     * @param {Array<{label:string, onClick:Function, kind?:string}>} actions
     */
    function showDraft(savedAt, actions = []) {
        draftText.textContent = `Brouillon local du ${formatClock(savedAt)} — partagé par les éditeurs, `
            + 'ignoré par l’application tant que le JSON exporté n’a pas remplacé le fichier.';
        draftActions.replaceChildren(...actions.map(action => {
            const button = element('button', `btn ${action.kind || 'ghost'} btn-sm`, action.label);
            button.type = 'button';
            button.addEventListener('click', action.onClick);
            return button;
        }));
        draftBar.hidden = false;
    }

    function hideDraft() {
        draftBar.hidden = true;
    }

    /** Un autre onglet d'éditeur a écrit ou effacé le brouillon. */
    function onExternalDraftChange(callback) {
        window.addEventListener('storage', event => {
            if (event.key === MASTER_ROUTES_DRAFT_KEY || event.key === null) callback();
        });
    }

    return { setRouteKey, showDraft, hideDraft, onExternalDraftChange };
}

/** Bandeau de rechargement quand le brouillon a changé ailleurs. */
export function showReloadNotice(message) {
    let notice = document.querySelector('.shell-notice');
    if (!notice) {
        notice = element('div', 'shell-notice');
        notice.setAttribute('role', 'alert');
        const text = element('span', 'shell-notice-text');
        const button = element('button', 'btn primary btn-sm', 'Recharger');
        button.type = 'button';
        button.addEventListener('click', () => location.reload());
        notice.append(icon('fa-sync-alt'), text, button);
        document.getElementById('editor-shell').appendChild(notice);
    }
    notice.querySelector('.shell-notice-text').textContent = message;
}

/** Demande confirmation avant de quitter tant que `isDirty()` est vrai. */
export function guardUnsavedChanges(isDirty) {
    window.addEventListener('beforeunload', event => {
        if (!isDirty()) return;
        event.preventDefault();
        event.returnValue = '';
    });
}
