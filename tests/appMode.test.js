// tests/appMode.test.js
// Passage d'un mode de transport à l'autre (js/app-mode.js) : mémoire du
// dernier mode et reprise au lancement du conteneur iOS.

import { describe, expect, it } from 'vitest';
import {
    APP_MODES, LAST_MODE_STORAGE_KEY, LAUNCH_FLAG_STORAGE_KEY, enterMode, otherMode, resolveLaunchRedirect
} from '../js/app-mode.js';

const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

function fakeWindow({ native = false, lastMode = null, launched = false } = {}) {
    const replaced = [];
    return {
        replaced,
        webkit: native ? { messageHandlers: { tallonNative: {} } } : undefined,
        localStorage: memoryStorage(lastMode ? { [LAST_MODE_STORAGE_KEY]: lastMode } : {}),
        sessionStorage: memoryStorage(launched ? { [LAUNCH_FLAG_STORAGE_KEY]: '1' } : {}),
        location: { replace: url => replaced.push(url) }
    };
}

describe('modes de transport', () => {
    it('chaque mode a sa page, embarquée dans le précache', () => {
        expect(APP_MODES.train.url).toBe('index.html');
        expect(APP_MODES.car.url).toBe('car.html');
        expect(otherMode('train')).toBe('car');
        expect(otherMode('car')).toBe('train');
    });
});

describe('reprise du dernier mode au lancement', () => {
    it('le conteneur iOS rouvre le dernier mode utilisé', () => {
        expect(resolveLaunchRedirect({ mode: 'train', lastMode: 'car', native: true, launched: false })).toBe('car.html');
        expect(resolveLaunchRedirect({ mode: 'train', lastMode: 'train', native: true, launched: false })).toBeNull();
        expect(resolveLaunchRedirect({ mode: 'train', lastMode: null, native: true, launched: false })).toBeNull();
        expect(resolveLaunchRedirect({ mode: 'train', lastMode: 'avion', native: true, launched: false })).toBeNull();
    });

    it('sur le web, la page ouverte est respectée (une icône PWA par mode)', () => {
        expect(resolveLaunchRedirect({ mode: 'train', lastMode: 'car', native: false, launched: false })).toBeNull();
    });

    it('après le lancement, changer de mode n’est jamais redirigé', () => {
        expect(resolveLaunchRedirect({ mode: 'train', lastMode: 'car', native: true, launched: true })).toBeNull();
    });
});

describe('enterMode', () => {
    it('mémorise le mode de la page ouverte', () => {
        const win = fakeWindow();
        expect(enterMode('car', win)).toBe(false);
        expect(win.localStorage.getItem(LAST_MODE_STORAGE_KEY)).toBe('car');
        expect(win.replaced).toEqual([]);
    });

    it('redirige le conteneur iOS une seule fois, sans écraser le mode mémorisé', () => {
        const win = fakeWindow({ native: true, lastMode: 'car' });
        expect(enterMode('train', win)).toBe(true);
        expect(win.replaced).toEqual(['car.html']);
        expect(win.localStorage.getItem(LAST_MODE_STORAGE_KEY)).toBe('car');
        // La page voiture s'ouvre, puis l'utilisateur revient au train.
        expect(enterMode('car', win)).toBe(false);
        expect(enterMode('train', win)).toBe(false);
        expect(win.localStorage.getItem(LAST_MODE_STORAGE_KEY)).toBe('train');
        expect(win.replaced).toHaveLength(1);
    });

    it('tolère un stockage indisponible', () => {
        const broken = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
        const win = { ...fakeWindow({ native: true }), localStorage: broken, sessionStorage: broken };
        expect(enterMode('train', win)).toBe(false);
    });
});
