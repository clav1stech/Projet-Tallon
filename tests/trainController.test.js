// tests/trainController.test.js
// Frontières entre navigation, configuration provisoire, configuration
// appliquée et session, sur les données réelles (lecture seule).

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE as STATE_SHAPE, createSessionState } from '../js/state.js';
import { ingestFix } from '../js/tracking-session.js';
import {
    adoptLocationMethod,
    applyDraft,
    getHomeAction,
    isDraftDirty,
    launchSession,
    revertDraft,
    setDraft,
    showView,
    stopSession
} from '../js/train-controller.js';
import { fixesAlongRoute } from './fixtures.js';

const master = JSON.parse(readFileSync('data/masterRoutes.normalized.json', 'utf8'));
const DEP = new Date(2026, 10, 15, 9, 58, 0, 0).getTime();
const LAUNCH = DEP - 120_000;

function freshState() {
    const state = structuredClone({ ...STATE_SHAPE, points: {}, trajets: [], railCorridor: null });
    state.session = createSessionState();
    state.points = master.points;
    state.trajets = master.trajets;
    return state;
}

/** Session lancée sur Paris → Lyon (arrêt Le Creusot), 40 min de trajet avec 2 min de retard. */
function runningState() {
    const state = freshState();
    setDraft(state, { mainRouteKey: 'PARIS_TO_LPD', stopIds: ['CREUSOT_TGV'], departureTime: '09:58' });
    expect(launchSession(state, LAUNCH)).toEqual({ ok: true });
    for (const f of fixesAlongRoute(state.currentRoute, DEP, { toSeconds: 2400, lateSeconds: 120 })) {
        ingestFix(state, f.position, f.ts, { locationMethod: 'geo' });
    }
    return state;
}

/** Tout ce qui relève de la session et du trajet suivi (hors navigation et provisoire). */
const tracked = (state) => structuredClone({
    session: state.session,
    appliedConfig: state.appliedConfig,
    planRevision: state.planRevision,
    departureTimestamp: state.departureTimestamp,
    locationMethod: state.locationMethod,
    lastSegmentIndex: state.lastSegmentIndex,
    passageTimes: state.passageTimes,
    passedPoints: state.passedPoints,
    passedPointMarkers: state.passedPointMarkers,
    currentDelay: state.currentDelay,
    trackingSnapshot: state.trackingSnapshot
});

/** Acquisitions brutes et garde-fous, sans l'annotation dérivée `routeKm`. */
const acquisitions = (state) => {
    const session = structuredClone(state.session);
    session.samples.forEach(s => { delete s.routeKm; });
    return session;
};

beforeAll(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('lancement', () => {
    it('n’est proposé que pour une configuration valide', () => {
        const state = freshState();
        expect(getHomeAction(state, LAUNCH)).toMatchObject({ mode: 'launch', enabled: false, status: 'no-route' });
        expect(launchSession(state, LAUNCH)).toEqual({ ok: false, reason: 'no-route' });
        setDraft(state, { mainRouteKey: 'PARIS_TO_LPD' });
        expect(getHomeAction(state, LAUNCH)).toMatchObject({ enabled: false, status: 'no-departure' });
        expect(state.session.active).toBe(false);
        setDraft(state, { departureTime: '09:58' });
        expect(getHomeAction(state, LAUNCH)).toMatchObject({ mode: 'launch', enabled: true, secondary: null });
    });

    it('applique la configuration, démarre la session et affiche le suivi', () => {
        const state = freshState();
        setDraft(state, { mainRouteKey: 'PARIS_TO_LPD', stopIds: ['CREUSOT_TGV'], departureTime: '09:58', locationMethod: 'sncf' });
        launchSession(state, LAUNCH);
        expect(state.view).toBe('tracking');
        expect(state.session).toMatchObject({ active: true, startedAt: LAUNCH });
        expect(state.appliedConfig).toEqual(state.draftConfig);
        expect(state.locationMethod).toBe('sncf');
        expect(state.departureTimestamp).toBe(DEP);
        expect(state.currentRoute.length).toBeGreaterThan(10);
    });

    it('un second lancement ne réinitialise jamais la session', () => {
        const state = runningState();
        const before = tracked(state);
        expect(launchSession(state, LAUNCH + 999_000)).toEqual({ ok: false, reason: 'already-active' });
        expect(tracked(state)).toEqual(before);
    });
});

describe('navigation', () => {
    it('accueil ↔ suivi ne modifie ni la session ni le trajet suivi', () => {
        const state = runningState();
        const before = tracked(state);
        for (let i = 0; i < 5; i++) {
            expect(showView(state, 'home')).toBe('home');
            expect(getHomeAction(state)).toMatchObject({ mode: 'resume', enabled: true, secondary: 'end' });
            expect(showView(state, 'tracking')).toBe('tracking');
        }
        expect(tracked(state)).toEqual(before);
    });

    it('le suivi n’est pas affichable sans session', () => {
        const state = freshState();
        expect(showView(state, 'tracking')).toBe('home');
    });

    it('la session continue d’acquérir pendant que l’accueil est affiché', () => {
        const state = runningState();
        showView(state, 'home');
        const count = state.session.samples.length;
        const passed = Object.keys(state.passageTimes).length;
        for (const f of fixesAlongRoute(state.currentRoute, DEP, { fromSeconds: 2405, toSeconds: 3600, lateSeconds: 120 })) {
            ingestFix(state, f.position, f.ts, { locationMethod: 'geo' });
        }
        expect(state.session.samples.length).toBeGreaterThan(count + 200);
        expect(Object.keys(state.passageTimes).length).toBeGreaterThan(passed);
        expect(state.view).toBe('home');
    });
});

describe('configuration provisoire', () => {
    it('modifier le formulaire n’affecte pas la session tant que rien n’est appliqué', () => {
        const state = runningState();
        const before = tracked(state);
        setDraft(state, { mainRouteKey: 'PARIS_TO_MARSEILLE' });
        setDraft(state, { stopIds: ['AVIGNON_TGV'], departureTime: '11:11', globalDeltaSeconds: 600, locationMethod: 'sncf' });
        expect(tracked(state)).toEqual(before);
        expect(isDraftDirty(state)).toBe(true);
        expect(getHomeAction(state)).toMatchObject({ mode: 'apply', enabled: true, secondary: 'cancel' });
    });

    it('changer de liaison vide les arrêts', () => {
        const state = freshState();
        setDraft(state, { mainRouteKey: 'PARIS_TO_LPD', stopIds: ['CREUSOT_TGV'] });
        expect(setDraft(state, { mainRouteKey: 'PARIS_TO_MACON' }).stopIds).toEqual([]);
    });

    it('« Annuler » restaure la configuration suivie', () => {
        const state = runningState();
        const before = tracked(state);
        setDraft(state, { stopIds: [], globalDeltaSeconds: 300 });
        revertDraft(state);
        expect(state.draftConfig).toEqual(state.appliedConfig);
        expect(isDraftDirty(state)).toBe(false);
        expect(tracked(state)).toEqual(before);
    });
});

describe('application en cours de session', () => {
    let state;
    let before;
    let rawBefore;
    beforeEach(() => {
        state = runningState();
        showView(state, 'home');
        before = tracked(state);
        rawBefore = acquisitions(state);
    });

    it('nouvelle heure de départ : écarts décalés d’autant, acquisitions intactes', () => {
        setDraft(state, { departureTime: '10:03' });
        expect(applyDraft(state)).toEqual({ ok: true, change: 'schedule' });

        expect(state.view).toBe('tracking');
        expect(acquisitions(state)).toEqual(rawBefore);
        expect(state.passageTimes).toEqual(before.passageTimes);
        expect(state.lastSegmentIndex).toBe(before.lastSegmentIndex);
        expect(state.planRevision).toBe(before.planRevision + 1);
        expect(Object.keys(state.passedPoints).length).toBeGreaterThan(5);
        for (const [id, delay] of Object.entries(before.passedPoints)) {
            expect(state.passedPoints[id]).toBe(delay - 300_000);
        }
        expect(state.currentDelay).toBeCloseTo(before.currentDelay - 300_000, 0);
    });

    it('ΔT et arrêts : mêmes franchissements, écarts recalculés sur le nouvel horaire', () => {
        setDraft(state, { stopIds: [], globalDeltaSeconds: 240 });
        expect(applyDraft(state)).toEqual({ ok: true, change: 'schedule' });

        expect(acquisitions(state)).toEqual(rawBefore);
        expect(state.passageTimes).toEqual(before.passageTimes);
        const plan = state.tripPlan;
        plan.route.forEach((point, idx) => {
            if (!(point.id in state.passageTimes)) return;
            expect(state.passedPoints[point.id]).toBe(state.passageTimes[point.id] - (plan.departureTimestamp + plan.offsetsSeconds[idx] * 1000));
        });
        expect(state.passedPoints).not.toEqual(before.passedPoints);
        expect(state.currentRoute.find(p => p.id === 'CREUSOT_TGV').isStop).toBe(false);
    });

    it('nouvelle liaison : trajet resynchronisé par rejeu de tout l’historique', () => {
        setDraft(state, { mainRouteKey: 'PARIS_TO_MARSEILLE' });
        expect(applyDraft(state)).toEqual({ ok: true, change: 'route' });

        expect(acquisitions(state)).toEqual(rawBefore);
        expect(state.currentRoute.at(-1).id).toBe('MARSEILLE_ST_CHARLES');
        expect(state.trackingSnapshot).not.toBeNull();
        // Les points communs aux deux liaisons gardent l'instant de passage observé.
        const common = Object.keys(before.passageTimes).filter(id => id in state.passageTimes);
        expect(common.length).toBeGreaterThan(5);
        for (const id of common) expect(state.passageTimes[id]).toBe(before.passageTimes[id]);
        expect(state.session.samples.every(s => s.routeKm != null)).toBe(true);
    });

    it('seule la source change : aucun recalcul, aucun nouveau plan', () => {
        setDraft(state, { locationMethod: 'sncf' });
        expect(applyDraft(state)).toEqual({ ok: true, change: 'source' });
        expect(state.locationMethod).toBe('sncf');
        expect(tracked(state)).toEqual({ ...before, appliedConfig: state.appliedConfig, locationMethod: 'sncf' });
    });

    it('configuration invalide : rien n’est modifié', () => {
        setDraft(state, { departureTime: '' });
        expect(getHomeAction(state)).toMatchObject({ mode: 'apply', enabled: false });
        expect(applyDraft(state)).toEqual({ ok: false, reason: 'no-departure' });
        expect(tracked(state)).toEqual(before);
        expect(state.view).toBe('home');
    });

    it('réappliquer après minuit garde le jour de départ de la session', () => {
        const night = freshState();
        const dep = new Date(2026, 10, 15, 23, 40, 0, 0).getTime();
        setDraft(night, { mainRouteKey: 'PARIS_TO_LPD', departureTime: '23:40' });
        launchSession(night, dep - 60_000);
        expect(night.departureTimestamp).toBe(dep);
        setDraft(night, { globalDeltaSeconds: 120 });
        applyDraft(night);
        expect(night.departureTimestamp).toBe(dep);
    });
});

describe('source et clôture', () => {
    it('une source imposée (bridge) n’apparaît pas comme une modification', () => {
        const state = runningState();
        adoptLocationMethod(state, 'sncf');
        expect(state.locationMethod).toBe('sncf');
        expect(isDraftDirty(state)).toBe(false);
    });

    it('« Terminer » efface la session et garde le formulaire', () => {
        const state = runningState();
        const draft = structuredClone(state.draftConfig);
        stopSession(state);
        expect(state.session).toEqual(createSessionState());
        expect(state.appliedConfig).toBeNull();
        expect(state.currentRoute).toEqual([]);
        expect(state.passageTimes).toEqual({});
        expect(state.view).toBe('home');
        expect(state.draftConfig).toEqual(draft);
        expect(getHomeAction(state, LAUNCH)).toMatchObject({ mode: 'launch', enabled: true });
    });
});
