import { describe, expect, it } from 'vitest';
import { STATE, createSessionState } from '../js/state.js';
import { buildCarouselModel, buildCockpitModel, buildSpeedProfile, ingestFix, installTripPlan, startSession } from '../js/tracking-session.js';
import { buildProfileEnvelope, buildRecentWindow } from '../js/train-profile.js';
import { fixesAlongRoute, planFromRoute, southboundRoute } from './fixtures.js';

const DEP = new Date(2026, 10, 15, 23, 58).getTime();
function stateWithFixes(options = {}) {
    const state = structuredClone(STATE);
    state.session = createSessionState();
    const route = southboundRoute();
    startSession(state, DEP);
    installTripPlan(state, planFromRoute(route, DEP));
    for (const fix of fixesAlongRoute(route, DEP, options)) ingestFix(state, fix.position, fix.ts, { locationMethod: 'geo' });
    return state;
}

describe('présentation du carousel', () => {
    it('sépare les observations historiques des prévisions et du théorique, après minuit', () => {
        const state = stateWithFixes({ toSeconds: 700, lateSeconds: 150 });
        const now = state.session.samples.at(-1).ts;
        const cockpit = buildCockpitModel(state, now);
        const points = buildCarouselModel(state, cockpit, now);
        const observed = points.filter(p => p.observedTs != null);
        const predicted = points.filter(p => p.estimatedTs != null);
        expect(observed.length).toBeGreaterThan(0);
        expect(predicted.length).toBeGreaterThan(0);
        for (const point of observed) {
            expect(point.estimatedTs).toBeNull();
            expect(point.observedTs - point.theoreticalTs).toBe(point.delayMs);
        }
        for (const point of predicted) {
            expect(point.observedTs).toBeNull();
            expect(point.estimatedTs).toBe(point.theoreticalTs + cockpit.displayDelayMs);
        }
        expect(new Date(points[1].theoreticalTs).getDate()).toBe(16);
    });

    it('n’invente pas de passage avant le premier fix ou au démarrage en cours de route', () => {
        const state = stateWithFixes({ fromSeconds: 500, toSeconds: 500 });
        let points = buildCarouselModel(state, buildCockpitModel(state, DEP + 500_000), DEP + 500_000);
        expect(points.every(p => p.observedTs == null)).toBe(true);
        expect(points.slice(0, 4).every(p => p.estimatedTs == null)).toBe(true);
        state.session = createSessionState();state.session.active = true;state.trackingSnapshot = null;
        points = buildCarouselModel(state, buildCockpitModel(state, DEP), DEP);
        expect(points.every(p => p.observedTs == null && p.estimatedTs == null && p.distanceKm == null)).toBe(true);
    });

    it('ne poursuit pas de prévision quand le signal est perdu', () => {
        const state = stateWithFixes({ toSeconds: 300 });
        const now = state.session.samples.at(-1).ts + 60_000;
        const points = buildCarouselModel(state, buildCockpitModel(state, now), now);
        expect(points.every(p => p.estimatedTs == null)).toBe(true);
        expect(points.some(p => p.observedTs != null)).toBe(true);
    });
});

describe('profil du voyage', () => {
    it('garde début, fin et pics d’une longue session, avec un tracé borné par la largeur', () => {
        const samples = Array.from({length:50_000}, (_, i) => ({ ts:i*1000,routeKm:i/100,v:i===10?349:i===49_990?1:200,reliable:true,speedReliable:true }));
        const profile = {samples,totalKm:500};
        const before = structuredClone(samples);
        const buckets = buildProfileEnvelope(profile, 320);
        expect(buckets.length).toBeLessThanOrEqual(320);
        expect(buckets[0].first).toBe(samples[0]);
        expect(buckets.at(-1).last).toBe(samples.at(-1));
        expect(buckets.some(b=>b.max.v===349)).toBe(true);
        expect(buckets.some(b=>b.min.v===1)).toBe(true);
        expect(samples).toEqual(before);
    });

    it('interrompt la courbe dans les trous de signal et hors du trajet', () => {
        const samples = [
            {ts:0,routeKm:0,v:100,reliable:true,speedReliable:true},
            {ts:1,routeKm:null,v:100,reliable:false},
            {ts:2,routeKm:5,v:140,reliable:true,speedReliable:true},
            {ts:3,routeKm:7,v:160,reliable:true,speedReliable:false},
            {ts:4,routeKm:10,v:180,reliable:true,speedReliable:true}
        ];
        const buckets=buildProfileEnvelope({samples,totalKm:10},100);
        expect(buckets).toHaveLength(3);
        expect(buckets[1].gap).toBe(true);
        expect(buckets[2].gap).toBe(true);
    });

    it('gère les états vides, sans distance et les fixes dans la même colonne', () => {
        expect(buildProfileEnvelope({samples:[],totalKm:0},0)).toEqual([]);
        const state = stateWithFixes({ toSeconds: 600, stepSeconds: .25 });
        const profile = buildSpeedProfile(state);
        expect(profile.samples.length).toBeGreaterThan(1200);
        const buckets = buildProfileEnvelope(profile, 1);
        expect(buckets).toHaveLength(1);
        expect(buckets[0].last).toBe(profile.samples.at(-1));
    });

    it('fenêtre récente : dernières mesures seulement, trous de signal et moyenne théorique du segment', () => {
        const planned = [{ fromKm: 0, toKm: 50, kmh: 200 }, { fromKm: 50, toKm: 100, kmh: 300 }];
        const samples = Array.from({ length: 3000 }, (_, i) => ({ ts: i * 1000, routeKm: i / 30, v: 250, reliable: true, speedReliable: true }));
        samples[2500] = { ts: 2_500_000, v: 250, reliable: false };
        samples[2990] = { ts: 2_990_000, routeKm: null, v: 120, reliable: true, speedReliable: true };
        const before = structuredClone(samples);
        const recent = buildRecentWindow({ samples, planned }, 900_000);
        expect(recent.toTs).toBe(2_999_000);
        expect(recent.fromTs).toBe(2_099_000);
        expect(recent.points).toHaveLength(900);
        expect(recent.points[0].ts).toBe(2_099_000);
        expect(recent.points[0].gap).toBe(true);
        expect(recent.points.find(p => p.ts === 2_501_000).gap).toBe(true);
        expect(recent.points.find(p => p.ts === 2_502_000).gap).toBe(false);
        expect(recent.points.find(p => p.ts === 2_100_000).plannedKmh).toBe(300);
        expect(recent.points.find(p => p.ts === 2_990_000).plannedKmh).toBeNull();
        expect(samples).toEqual(before);
        expect(buildRecentWindow({ samples: [], planned }, 900_000)).toEqual({ fromTs: null, toTs: null, points: [] });
        expect(buildRecentWindow({ samples: samples.slice(0, 60), planned }, 900_000).points[59].plannedKmh).toBe(200);
    });
});
