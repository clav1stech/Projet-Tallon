// tests/tripConfig.test.js
// Configuration de trajet, plan horaire et synthèse de desserte, sur les
// données réelles (lecture seule).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    buildPatternFromConfig,
    buildServiceSummary,
    buildTripPlan,
    createTripConfig,
    diffTripConfig,
    resolveDepartureTimestamp,
    tripConfigsEqual
} from '../js/trip-config.js';

const master = JSON.parse(readFileSync('data/masterRoutes.normalized.json', 'utf8'));
const data = { points: master.points, trajets: master.trajets };
const at = (h, m, day = 15) => new Date(2026, 10, day, h, m, 0, 0).getTime();

beforeAll(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('createTripConfig / diffTripConfig', () => {
    it('donne une forme canonique : arrêts ordonnés, filtrés, ΔT borné', () => {
        const cfg = createTripConfig({
            mainRouteKey: 'PARIS_TO_LPD',
            stopIds: ['MACON_LOCHE', 'AVIGNON_TGV', 'CREUSOT_TGV', 'MACON_LOCHE'],
            departureTime: '09:58',
            globalDeltaSeconds: 99999,
            locationMethod: 'autre'
        });
        expect(cfg).toEqual({
            mainRouteKey: 'PARIS_TO_LPD',
            stopIds: ['CREUSOT_TGV', 'MACON_LOCHE'],
            departureTime: '09:58',
            globalDeltaSeconds: 1800,
            locationMethod: 'geo'
        });
    });

    it('neutralise une liaison inconnue et une heure invalide', () => {
        const cfg = createTripConfig({ mainRouteKey: 'NOPE', stopIds: ['CREUSOT_TGV'], departureTime: 'abc' });
        expect(cfg.mainRouteKey).toBe('');
        expect(cfg.stopIds).toEqual([]);
        expect(cfg.departureTime).toBe('');
    });

    it('classe les écarts par nature d’impact', () => {
        const base = { mainRouteKey: 'PARIS_TO_LPD', stopIds: ['CREUSOT_TGV'], departureTime: '09:58' };
        expect(tripConfigsEqual(base, { ...base, stopIds: ['CREUSOT_TGV'] })).toBe(true);
        expect(diffTripConfig(base, { ...base, locationMethod: 'sncf' })).toEqual({ route: false, schedule: false, source: true, any: true });
        expect(diffTripConfig(base, { ...base, globalDeltaSeconds: 60 })).toMatchObject({ route: false, schedule: true });
        expect(diffTripConfig(base, { ...base, stopIds: [] })).toMatchObject({ route: false, schedule: true });
        expect(diffTripConfig(base, { ...base, departureTime: '10:00' })).toMatchObject({ route: false, schedule: true });
        expect(diffTripConfig(base, { ...base, mainRouteKey: 'PARIS_TO_MACON' })).toMatchObject({ route: true, schedule: true });
    });
});

describe('buildPatternFromConfig', () => {
    it('ordonne les arrêts selon le sens réel du parcours', () => {
        const sud = buildPatternFromConfig(createTripConfig({ mainRouteKey: 'PARIS_TO_MARSEILLE', stopIds: ['AVIGNON_TGV', 'CREUSOT_TGV'] }), data.trajets);
        expect(sud.stops).toEqual(['PARIS_LYON', 'CREUSOT_TGV', 'AVIGNON_TGV', 'MARSEILLE_ST_CHARLES']);
        const nord = buildPatternFromConfig(createTripConfig({ mainRouteKey: 'MARSEILLE_TO_PARIS', stopIds: ['CREUSOT_TGV', 'AVIGNON_TGV'] }), data.trajets);
        expect(nord.stops).toEqual(['MARSEILLE_ST_CHARLES', 'AVIGNON_TGV', 'CREUSOT_TGV', 'PARIS_LYON']);
    });

    it('retourne null sans données', () => {
        expect(buildPatternFromConfig(createTripConfig({ mainRouteKey: 'PARIS_TO_LPD' }), [])).toBeNull();
    });
});

describe('resolveDepartureTimestamp', () => {
    it('rattache l’heure au jour de référence', () => {
        expect(resolveDepartureTimestamp('09:58', at(8, 0))).toBe(at(9, 58));
        expect(resolveDepartureTimestamp('09:58', at(13, 0))).toBe(at(9, 58));
    });

    it('rattache à la veille un train parti avant minuit', () => {
        expect(resolveDepartureTimestamp('23:40', at(0, 10))).toBe(at(23, 40, 14));
    });

    it('rattache au lendemain un départ juste après minuit', () => {
        expect(resolveDepartureTimestamp('00:15', at(23, 50))).toBe(at(0, 15, 16));
    });

    it('retourne null pour une heure absente ou illisible', () => {
        expect(resolveDepartureTimestamp('', at(8, 0))).toBeNull();
        expect(resolveDepartureTimestamp('xx:yy', at(8, 0))).toBeNull();
    });
});

describe('buildTripPlan', () => {
    it('signale chaque état de configuration sans horaire trompeur', () => {
        expect(buildTripPlan({}, data).status).toBe('no-route');
        expect(buildTripPlan({ mainRouteKey: 'PARIS_TO_LPD', departureTime: '09:58' }, { points: {}, trajets: [] }).status).toBe('data-unavailable');
        expect(buildTripPlan({ mainRouteKey: 'PARIS_TO_LPD', departureTime: '09:58' }, { points: {}, trajets: data.trajets }).status).toBe('data-unavailable');
        const noDeparture = buildTripPlan({ mainRouteKey: 'PARIS_TO_LPD' }, data);
        expect(noDeparture.status).toBe('no-departure');
        expect(noDeparture.departureTimestamp).toBeNull();
        expect(noDeparture.totalSeconds).toBeGreaterThan(0);
    });

    it('produit des cumuls cohérents avec la route effective', () => {
        const plan = buildTripPlan({ mainRouteKey: 'PARIS_TO_LPD', stopIds: ['CREUSOT_TGV'], departureTime: '09:58' }, data, at(9, 0));
        expect(plan.status).toBe('ok');
        expect(plan.departureTimestamp).toBe(at(9, 58));
        expect(plan.offsetsSeconds).toHaveLength(plan.route.length);
        expect(plan.cumKm).toHaveLength(plan.route.length);
        const sum = plan.route.slice(0, -1).reduce((acc, p) => acc + p.durationEffective, 0);
        expect(plan.totalSeconds).toBe(sum);
        expect(plan.totalKm).toBeGreaterThan(380);
    });
});

describe('buildServiceSummary', () => {
    const summaryFor = (config, ref = at(9, 0)) => buildServiceSummary(buildTripPlan(config, data, ref));

    it('ne liste que les gares commerciales desservies, dans l’ordre', () => {
        const summary = summaryFor({ mainRouteKey: 'PARIS_TO_MARSEILLE', stopIds: ['AVIGNON_TGV', 'CREUSOT_TGV'], departureTime: '09:58' });
        expect(summary.stops.map(s => s.id)).toEqual(['PARIS_LYON', 'CREUSOT_TGV', 'AVIGNON_TGV', 'MARSEILLE_ST_CHARLES']);
        expect(summary.stops.map(s => s.role)).toEqual(['origin', 'stop', 'stop', 'terminus']);
        expect(summary.intermediateStopCount).toBe(2);
        expect(summary.stops[0].time).toBe('09:58');
        const times = summary.stops.map(s => s.timestamp);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(summary.stops.reduce((acc, s) => acc + s.legSeconds, 0)).toBe(summary.totalSeconds);
    });

    it('propose tous les arrêts de la liaison, dans l’ordre du parcours', () => {
        const summary = summaryFor({ mainRouteKey: 'PARIS_TO_MARSEILLE', stopIds: ['VALENCE_TGV'], departureTime: '09:58' });
        expect(summary.stopOptions.map(s => s.id)).toEqual(['CREUSOT_TGV', 'MACON_LOCHE', 'LYON_ST_EX', 'VALENCE_TGV', 'AVIGNON_TGV', 'AIX_TGV']);
        expect(summary.stopOptions.filter(s => s.selected).map(s => s.id)).toEqual(['VALENCE_TGV']);
        const retour = summaryFor({ mainRouteKey: 'LPD_TO_PARIS', departureTime: '09:58' });
        expect(retour.stopOptions.map(s => s.id)).toEqual(['MACON_LOCHE', 'CREUSOT_TGV']);
    });

    it('recalcule les horaires quand un arrêt, le départ ou ΔT changent', () => {
        const base = { mainRouteKey: 'PARIS_TO_LPD', stopIds: [], departureTime: '09:58' };
        const direct = summaryFor(base);
        const withStop = summaryFor({ ...base, stopIds: ['CREUSOT_TGV'] });
        const arrival = (s) => s.stops[s.stops.length - 1].timestamp;
        // Pénalité d'arrêt du moteur : 6 min par arrêt intermédiaire.
        expect(arrival(withStop) - arrival(direct)).toBe(360_000);
        expect(arrival(summaryFor({ ...base, globalDeltaSeconds: 300 })) - arrival(direct)).toBeCloseTo(300_000, -4);
        expect(arrival(summaryFor({ ...base, departureTime: '10:28' })) - arrival(direct)).toBe(30 * 60_000);
    });

    it('date correctement les arrivées après minuit', () => {
        const summary = summaryFor({ mainRouteKey: 'PARIS_TO_MARSEILLE', stopIds: ['AVIGNON_TGV'], departureTime: '22:30' }, at(22, 0));
        const [origin, , terminus] = summary.stops;
        expect(origin.dayOffset).toBe(0);
        expect(terminus.dayOffset).toBe(1);
        expect(terminus.timestamp).toBeGreaterThan(at(0, 0, 16));
        expect(terminus.time < origin.time).toBe(true);
    });

    it('sans heure de départ : gares connues, horaires absents', () => {
        const summary = summaryFor({ mainRouteKey: 'PARIS_TO_LPD', stopIds: ['CREUSOT_TGV'] });
        expect(summary.status).toBe('no-departure');
        expect(summary.stops).toHaveLength(3);
        expect(summary.stops.every(s => s.time === null && s.timestamp === null)).toBe(true);
    });

    it('sans liaison ou sans données : aucune gare', () => {
        expect(summaryFor({}).stops).toEqual([]);
        expect(buildServiceSummary(buildTripPlan({ mainRouteKey: 'PARIS_TO_LPD' }, { points: {}, trajets: [] })).status).toBe('data-unavailable');
    });
});
