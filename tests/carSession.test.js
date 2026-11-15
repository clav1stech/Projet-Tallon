// tests/carSession.test.js
// Session du mode voiture (js/car-session.js) et règles communes de cycle de
// session (js/session-flow.js) : frontières entre navigation, itinéraire
// provisoire, itinéraire appliqué et session.

import { beforeEach, describe, expect, it } from 'vitest';
import { CAR_ROUTES } from '../js/car-config.js';
import {
    CAR_ROUTE_STORAGE_KEY,
    applyDraft,
    averageSpeedKmh,
    createCarSessionState,
    createTripStats,
    getHomeAction,
    isDraftDirty,
    launchSession,
    listRoutePairs,
    recordMeasuredFix,
    restoreCarSettings,
    revertDraft,
    reverseRouteKey,
    routeEndpoints,
    saveCarSettings,
    setDraft,
    showView,
    stopSession
} from '../js/car-session.js';
import { resolveHomeAction, resolveView } from '../js/session-flow.js';

const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

describe('règles communes de session', () => {
    it('lancement, application et reprise selon l’état', () => {
        expect(resolveHomeAction({ active: false, dirty: false, valid: true })).toEqual({ mode: 'launch', enabled: true, secondary: null });
        expect(resolveHomeAction({ active: false, dirty: false, valid: false }).enabled).toBe(false);
        expect(resolveHomeAction({ active: true, dirty: true, valid: true })).toEqual({ mode: 'apply', enabled: true, secondary: 'cancel' });
        expect(resolveHomeAction({ active: true, dirty: true, valid: false }).enabled).toBe(false);
        // Reprendre reste possible même si le formulaire est devenu invalide.
        expect(resolveHomeAction({ active: true, dirty: false, valid: false })).toEqual({ mode: 'resume', enabled: true, secondary: 'end' });
    });

    it('le suivi n’est affichable que pendant une session', () => {
        expect(resolveView('tracking', false)).toBe('home');
        expect(resolveView('tracking', true)).toBe('tracking');
        expect(resolveView('home', true)).toBe('home');
    });
});

describe('itinéraires voiture : trajets et sens', () => {
    it('lit départ et destination dans le libellé', () => {
        expect(routeEndpoints(CAR_ROUTES, 'MACON_COMBLOUX')).toEqual({ origin: 'Mâcon', destination: 'Combloux' });
        expect(routeEndpoints(CAR_ROUTES, 'INCONNU')).toBeNull();
    });

    it('associe les deux sens d’une même liaison', () => {
        expect(reverseRouteKey(CAR_ROUTES, 'MACON_COMBLOUX')).toBe('COMBLOUX_MACON');
        expect(reverseRouteKey(CAR_ROUTES, 'COMBLOUX_MACON')).toBe('MACON_COMBLOUX');
        expect(reverseRouteKey({ SEUL: { label: 'A → B' } }, 'SEUL')).toBeNull();
    });

    it('propose une entrée par liaison, sans doublon de sens', () => {
        const pairs = listRoutePairs(CAR_ROUTES);
        expect(pairs).toHaveLength(1);
        expect(pairs[0]).toEqual({ label: 'Mâcon ↔ Combloux', keys: ['MACON_COMBLOUX', 'COMBLOUX_MACON'] });
    });
});

describe('cycle de session voiture', () => {
    let state;
    beforeEach(() => {
        state = createCarSessionState();
        setDraft(state, { routeKey: 'MACON_COMBLOUX' });
    });

    it('ne lance pas un itinéraire indisponible', () => {
        expect(getHomeAction(state, false)).toMatchObject({ mode: 'launch', enabled: false });
        expect(launchSession(state, false)).toEqual({ ok: false, reason: 'route-unavailable' });
        expect(state.session.active).toBe(false);
    });

    it('lance la session sur l’itinéraire provisoire', () => {
        expect(launchSession(state, true, 1000)).toEqual({ ok: true });
        expect(state).toMatchObject({ view: 'tracking', appliedConfig: { routeKey: 'MACON_COMBLOUX' }, session: { active: true, startedAt: 1000 } });
        expect(launchSession(state, true, 2000)).toEqual({ ok: false, reason: 'already-active' });
        expect(state.session.startedAt).toBe(1000);
    });

    it('naviguer ou éditer le formulaire ne touche pas à la session', () => {
        launchSession(state, true, 1000);
        const session = state.session;
        showView(state, 'home');
        setDraft(state, { routeKey: 'COMBLOUX_MACON' });
        expect(state.session).toBe(session);
        expect(state.appliedConfig.routeKey).toBe('MACON_COMBLOUX');
        expect(isDraftDirty(state)).toBe(true);
        expect(getHomeAction(state, true)).toEqual({ mode: 'apply', enabled: true, secondary: 'cancel' });
    });

    it('annuler reprend l’itinéraire suivi', () => {
        launchSession(state, true);
        setDraft(state, { routeKey: 'COMBLOUX_MACON' });
        revertDraft(state);
        expect(state.draftConfig.routeKey).toBe('MACON_COMBLOUX');
        expect(getHomeAction(state, true).mode).toBe('resume');
    });

    it('appliquer signale un changement d’itinéraire sans recréer la session', () => {
        launchSession(state, true, 1000);
        const session = state.session;
        showView(state, 'home');
        expect(applyDraft(state, true)).toEqual({ ok: true, change: 'none' });
        showView(state, 'home');
        setDraft(state, { routeKey: 'COMBLOUX_MACON' });
        expect(applyDraft(state, false)).toEqual({ ok: false, reason: 'route-unavailable' });
        expect(state.appliedConfig.routeKey).toBe('MACON_COMBLOUX');
        expect(applyDraft(state, true)).toEqual({ ok: true, change: 'route' });
        expect(state).toMatchObject({ view: 'tracking', appliedConfig: { routeKey: 'COMBLOUX_MACON' } });
        expect(state.session).toBe(session);
    });

    it('clôturer conserve l’itinéraire choisi', () => {
        launchSession(state, true);
        stopSession(state);
        expect(state).toMatchObject({ view: 'home', appliedConfig: null, session: { active: false }, draftConfig: { routeKey: 'MACON_COMBLOUX' } });
        expect(showView(state, 'tracking')).toBe('home');
        expect(applyDraft(state, true)).toEqual({ ok: false, reason: 'no-session' });
    });
});

describe('préférences voiture', () => {
    it('mémorise l’itinéraire sous une clé propre au mode', () => {
        const storage = memoryStorage({ selectedMainRouteKey: 'PARIS_TO_MARSEILLE' });
        const state = createCarSessionState();
        restoreCarSettings(state, CAR_ROUTES, storage);
        expect(state.draftConfig.routeKey).toBe('MACON_COMBLOUX');
        setDraft(state, { routeKey: 'COMBLOUX_MACON' });
        saveCarSettings(state, storage);
        expect(storage.getItem(CAR_ROUTE_STORAGE_KEY)).toBe('COMBLOUX_MACON');
        expect(storage.getItem('selectedMainRouteKey')).toBe('PARIS_TO_MARSEILLE');

        const reopened = createCarSessionState();
        restoreCarSettings(reopened, CAR_ROUTES, storage);
        expect(reopened.draftConfig.routeKey).toBe('COMBLOUX_MACON');
    });

    it('ignore un itinéraire mémorisé qui n’existe plus', () => {
        const state = createCarSessionState();
        restoreCarSettings(state, CAR_ROUTES, memoryStorage({ [CAR_ROUTE_STORAGE_KEY]: 'ANCIEN' }));
        expect(state.draftConfig.routeKey).toBe('MACON_COMBLOUX');
    });
});

describe('statistiques du trajet', () => {
    it('moyenne et maximum depuis les seules positions mesurées', () => {
        const stats = createTripStats();
        expect(averageSpeedKmh(stats)).toBe(0);
        recordMeasuredFix(stats, { ts: 0, routeKm: 10, speedKmh: 90, speedReliable: true });
        recordMeasuredFix(stats, { ts: 1_800_000, routeKm: 60, speedKmh: 128, speedReliable: true });
        // Vitesse non fiable : compte pour la distance, pas pour le maximum.
        recordMeasuredFix(stats, { ts: 3_600_000, routeKm: 110, speedKmh: 200, speedReliable: false });
        expect(averageSpeedKmh(stats)).toBeCloseTo(100, 6);
        expect(stats.maxKmh).toBe(128);
    });

    it('un fix non accroché à l’itinéraire ne déplace pas la moyenne', () => {
        const stats = createTripStats();
        recordMeasuredFix(stats, { ts: 0, routeKm: null, speedKmh: 50, speedReliable: true });
        expect(stats.firstTs).toBeNull();
        expect(stats.maxKmh).toBe(50);
    });
});
