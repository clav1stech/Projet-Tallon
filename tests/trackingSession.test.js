// tests/trackingSession.test.js
// Session de tracking : acquisition, accrochage au trajet, rejeu et vues de
// données, sur la route synthétique des fixtures.

import { beforeEach, describe, expect, it } from 'vitest';
import { STATE as STATE_SHAPE, createSessionState } from '../js/state.js';
import {
    acceptFix,
    buildCockpitModel,
    buildSpeedProfile,
    endSession,
    getLocationStatus,
    getPassageLog,
    ingestFix,
    installTripPlan,
    recordSignalLossTick,
    replaySession,
    startSession
} from '../js/tracking-session.js';
import { fixesAlongRoute, planFromRoute, positionOnSegment, southboundRoute } from './fixtures.js';

const DEP = new Date(2026, 10, 15, 9, 58, 0, 0).getTime();
const OPTS = { locationMethod: 'geo' };

function freshState() {
    const state = structuredClone({ ...STATE_SHAPE, points: {}, trajets: [], railCorridor: null });
    state.session = createSessionState();
    return state;
}

function startedState(route = southboundRoute(), departure = DEP) {
    const state = freshState();
    startSession(state, departure - 60_000);
    installTripPlan(state, planFromRoute(route, departure));
    return state;
}

const feed = (state, fixes) => fixes.map(f => ingestFix(state, f.position, f.ts, OPTS));
const fixAt = (route, segIdx, t, ts, extra = {}) => ({
    coords: { latitude: positionOnSegment(route, segIdx, t).lat, longitude: positionOnSegment(route, segIdx, t).lon, accuracy: 10, ...extra },
    timestamp: ts
});

describe('acquisition', () => {
    let route;
    let state;
    beforeEach(() => { route = southboundRoute(); state = startedState(route); });

    it('ignore tout fix hors session', () => {
        const idle = freshState();
        expect(ingestFix(idle, fixAt(route, 0, 0.5, DEP), DEP, OPTS)).toEqual({ accepted: false, reason: 'inactive' });
        expect(idle.session.samples).toHaveLength(0);
    });

    it('conserve tout l’historique de la session, sans fenêtre glissante', () => {
        const fixes = fixesAlongRoute(route, DEP, { stepSeconds: 0.25 });
        expect(fixes.length).toBeGreaterThan(1800);
        feed(state, fixes);
        expect(state.session.samples).toHaveLength(fixes.length);
        expect(state.session.samples[0].ts).toBe(fixes[0].ts);
    });

    it('rejette un fix imprécis et une téléportation sans les historiser', () => {
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 60 }));
        const count = state.session.samples.length;
        const ts = DEP + 65_000;
        expect(acceptFix(state, fixAt(route, 0, 0.6, ts, { accuracy: 2000 }), ts, OPTS).reason).toBe('accuracy');
        const far = { coords: { latitude: 45, longitude: 5, accuracy: 10 }, timestamp: ts + 1000 };
        expect(acceptFix(state, far, ts + 1000, OPTS).reason).toBe('teleport');
        expect(state.session.gpsRecoveryMode).toBe(true);
        expect(state.session.samples).toHaveLength(count);
    });

    it('n’assimile pas une vitesse SNCF absente à une vitesse nulle', () => {
        const opts = { locationMethod: 'sncf' };
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 30 }));
        const ts = DEP + 35_000;
        const withNull = ingestFix(state, fixAt(route, 0, 0.3, ts, { speed: null }), ts, opts);
        expect(withNull.sample.v).toBeGreaterThan(0);
        expect(withNull.sample.speedReliable).toBe(false);
        const withSpeed = ingestFix(state, fixAt(route, 0, 0.34, ts + 5000, { speed: withNull.sample.v + 1 }), ts + 5000, opts);
        expect(withSpeed.sample.v).toBe(withNull.sample.v + 1);
        expect(withSpeed.sample.speedReliable).toBe(true);
    });

    it('prolonge l’historique en non fiable pendant une perte de signal bornée', () => {
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 60 }));
        const last = state.session.samples.at(-1);
        expect(recordSignalLossTick(state, last.ts + 10_000)).toBe(false);
        expect(recordSignalLossTick(state, last.ts + 20_000)).toBe(true);
        expect(state.session.samples.at(-1)).toEqual({ ts: last.ts + 20_000, v: last.v, reliable: false });
        expect(getLocationStatus(state, last.ts + 20_000).signal).toBe('lost');
        expect(recordSignalLossTick(state, last.ts + 400_000)).toBe(false);
    });
});

describe('accrochage au trajet', () => {
    it('constate les franchissements et leur écart à l’horaire', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { lateSeconds: 90 }));

        const log = getPassageLog(state);
        expect(log.map(p => p.pointId)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
        for (const passage of log) {
            expect(passage.delayMs).toBe(passage.ts - passage.theoreticalTs);
            expect(passage.delayMs).toBeGreaterThan(60_000);
            expect(passage.delayMs).toBeLessThan(120_000);
        }
        // Retard gelé à l'arrivée.
        expect(state.currentDelay).toBe(state.passedPoints.P8);
        expect(state.trackingSnapshot.displayIdx).toBe(route.length - 1);
    });
});

describe('compensation du retard de la position WiFi SNCF', () => {
    const SNCF = { locationMethod: 'sncf' };

    it('avance la position mesurée de la distance parcourue pendant le retard', () => {
        const route = southboundRoute();
        const ts = DEP + 60_000;
        const measured = startedState(route);
        ingestFix(measured, fixAt(route, 1, 0.5, ts), ts, OPTS);
        const sncf = startedState(route);
        const { sample, snapshot } = ingestFix(sncf, fixAt(route, 1, 0.5, ts, { speed: 180 }), ts, SNCF);
        expect(sample.leadKm).toBeCloseTo(0.1, 9);
        expect(snapshot.segmentIndex).toBe(1);
        expect(snapshot.routeKm - measured.trackingSnapshot.routeKm).toBeCloseTo(0.1, 3);
        expect(snapshot.currentDelayMs).toBeLessThan(measured.trackingSnapshot.currentDelayMs);
    });

    it('franchit le point suivant quand l’avance dépasse la fin du segment', () => {
        const route = southboundRoute();
        const state = startedState(route);
        const ts = DEP + 60_000;
        const { snapshot } = ingestFix(state, fixAt(route, 1, 0.9999, ts, { speed: 300 }), ts, SNCF);
        expect(snapshot.segmentIndex).toBe(2);
        expect(state.passageTimes[route[2].id]).toBe(ts);
    });

    it('ne s’applique pas au GPS du téléphone', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 60 }));
        expect(state.session.samples.every(s => s.leadKm === 0)).toBe(true);
    });
});

describe('positions aberrantes persistantes', () => {
    // Routeur WiFi en tunnel : une série de positions impossibles finit par
    // être acceptée par l'anti-téléportation (ré-ancrage), sans pour autant
    // faire franchir de point au train.
    const glitch = (route, pointIdx, fromTs, count) => Array.from({ length: count }, (_, k) => {
        const ts = fromTs + k * 1000;
        const { lat, lon } = route[pointIdx];
        return { ts, position: { coords: { latitude: lat, longitude: lon, accuracy: 10 }, timestamp: ts } };
    });

    it('ne franchit ni le terminus ni aucun point, puis reprend au passage réel', () => {
        const route = southboundRoute();
        const state = startedState(route);
        const before = fixesAlongRoute(route, DEP, { toSeconds: 300, stepSeconds: 1 });
        const bogus = glitch(route, route.length - 1, DEP + 301_000, 8);
        const after = fixesAlongRoute(route, DEP, { fromSeconds: 309, stepSeconds: 1 });
        feed(state, before);
        feed(state, bogus);
        expect(Object.keys(state.passageTimes)).toEqual(['P1', 'P2']);
        expect(buildCockpitModel(state, DEP + 309_000).phase).toBe('running');

        feed(state, after);
        const order = state.passedPointMarkers.map(marker => marker.pointId);
        expect(order).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
        const ts = order.map(id => state.passageTimes[id]);
        expect(ts).toEqual([...ts].sort((a, b) => a - b));
        // Passage réel au terminus, à l'heure : aucun retard fictif figé.
        expect(state.passageTimes.P8).toBeGreaterThan(DEP + 950_000);
        expect(Math.abs(state.passedPoints.P8)).toBeLessThan(10_000);
    });

    it('accepte une vraie avance après une suspension de l’app', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 120, stepSeconds: 1 }));
        feed(state, fixesAlongRoute(route, DEP, { fromSeconds: 720, toSeconds: 730, stepSeconds: 1 }));
        expect(state.passageTimes).toHaveProperty('P5');
        expect(state.trackingSnapshot.segmentIndex).toBe(6);
    });

    it('rejette la position (0, 0) d’un récepteur sans fix', () => {
        const state = startedState();
        const zero = { coords: { latitude: 0, longitude: 0, accuracy: 10 }, timestamp: DEP };
        expect(acceptFix(state, zero, DEP, OPTS)).toEqual({ accepted: false, reason: 'invalid' });
    });

    it('rejoue la séquence à l’identique', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 300, stepSeconds: 1 }));
        feed(state, glitch(route, route.length - 1, DEP + 301_000, 8));
        feed(state, fixesAlongRoute(route, DEP, { fromSeconds: 309, stepSeconds: 1 }));
        const live = structuredClone({ passageTimes: state.passageTimes, passedPoints: state.passedPoints });
        replaySession(state);
        expect({ passageTimes: state.passageTimes, passedPoints: state.passedPoints }).toEqual(live);
    });
});

describe('rejeu', () => {
    it('redonne exactement l’état dérivé obtenu en direct', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 700, lateSeconds: 45 }));
        const derived = () => structuredClone({
            lastSegmentIndex: state.lastSegmentIndex,
            passageTimes: state.passageTimes,
            passedPoints: state.passedPoints,
            passedPointMarkers: state.passedPointMarkers,
            currentDelay: state.currentDelay,
            trackingSnapshot: state.trackingSnapshot,
            routeKm: state.session.samples.map(s => s.routeKm)
        });
        const live = derived();
        const session = structuredClone(state.session);
        replaySession(state);
        expect(derived()).toEqual(live);
        expect(state.session).toEqual(session);
    });

    it('réévalue les écarts contre un nouvel horaire sans toucher aux instants observés', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 500, lateSeconds: 45 }));
        const times = { ...state.passageTimes };
        const delays = { ...state.passedPoints };
        const sampleCount = state.session.samples.length;

        installTripPlan(state, planFromRoute(route, DEP + 120_000));
        replaySession(state);

        expect(state.passageTimes).toEqual(times);
        expect(state.session.samples).toHaveLength(sampleCount);
        for (const id of Object.keys(delays)) expect(state.passedPoints[id]).toBe(delays[id] - 120_000);
    });
});

describe('vues de données', () => {
    it('fournit le profil de vitesse intégral, repéré en km', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 600 }));
        const profile = buildSpeedProfile(state);

        expect(profile.samples).toBe(state.session.samples);
        expect(profile.stops.map(s => s.id)).toEqual(['P0', 'P4', 'P8']);
        expect(profile.planned).toHaveLength(route.length - 1);
        expect(profile.planned[0].kmh).toBeCloseTo(route[0].segmentLengthToNext / 120 * 3600, 5);
        expect(profile.passages.map(p => p.pointId)).toEqual(['P1', 'P2', 'P3', 'P4']);
        const kms = profile.samples.map(s => s.routeKm);
        expect(kms.every((km, i) => i === 0 || km >= kms[i - 1] - 0.05)).toBe(true);
        expect(profile.currentKm).toBeCloseTo(profile.totalKm * 600 / 960, 0);
        expect(profile.maxKmh).toBeGreaterThan(100);
    });

    it('fournit le modèle du cockpit : retard, arrivée, prochain arrêt, progression', () => {
        const route = southboundRoute();
        const state = startedState(route);
        const fixes = fixesAlongRoute(route, DEP, { toSeconds: 300, lateSeconds: 150 });
        feed(state, fixes);
        const now = fixes.at(-1).ts;
        const model = buildCockpitModel(state, now);

        expect(model.phase).toBe('running');
        expect(model.delayMs).toBeGreaterThan(120_000);
        expect(model.displayDelayMs).toBe(120_000);
        expect(model.arrival.theoreticalTs).toBe(DEP + 960_000);
        expect(model.arrival.estimatedTs).toBe(DEP + 960_000 + 120_000);
        expect(model.nextStop).toMatchObject({ id: 'P4', isTerminus: false, theoreticalTs: DEP + 480_000 });
        expect(model.nextStop.distanceKm).toBeGreaterThan(0);
        expect(model.progress.doneKm + model.progress.leftKm).toBeCloseTo(model.progress.totalKm, 6);
        expect(model.stats.avgKmh).toBeGreaterThan(50);
        expect(model.stats.maxKmh).toBeGreaterThan(40);
        expect(model.location.signal).toBe('ok');
    });

    it('avant le premier fix : horaires théoriques, localisation en attente', () => {
        const state = startedState();
        const model = buildCockpitModel(state, DEP - 30_000);
        expect(model.phase).toBe('before-departure');
        expect(model.speedKmh).toBeNull();
        expect(model.displayDelayMs).toBe(0);
        expect(model.nextStop.id).toBe('P4');
        expect(model.location.signal).toBe('waiting');
        expect(buildCockpitModel(freshState(), DEP)).toBeNull();
    });

    it('à l’arrivée : phase « arrived », plus de prochain arrêt', () => {
        const route = southboundRoute();
        const state = startedState(route);
        const fixes = fixesAlongRoute(route, DEP);
        feed(state, fixes);
        const model = buildCockpitModel(state, fixes.at(-1).ts);
        expect(model.phase).toBe('arrived');
        expect(model.nextStop).toBeNull();
        expect(model.progress.ratio).toBeCloseTo(1, 2);
    });
});

describe('clôture', () => {
    it('efface l’historique et les dérivés', () => {
        const route = southboundRoute();
        const state = startedState(route);
        feed(state, fixesAlongRoute(route, DEP, { toSeconds: 300 }));
        endSession(state);
        expect(state.session).toEqual(createSessionState());
        expect(state.passageTimes).toEqual({});
        expect(state.trackingSnapshot).toBeNull();
    });
});
