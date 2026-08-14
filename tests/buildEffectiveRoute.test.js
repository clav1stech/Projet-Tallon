// tests/buildEffectiveRoute.test.js
import { describe, it, expect } from 'vitest';
import { buildEffectiveRoute } from '../js/functions.js';

const POINTS = {
    A: { name: 'Alpha', lat: 48.80, lon: 2.40, type: 'gare' },
    B: { name: 'Bravo', lat: 48.70, lon: 2.45, type: 'passage' },
    BIF: {
        name: 'Bif', lat: 48.60, lon: 2.50, type: 'bifurcation',
        lat_V1: 48.601, lon_V1: 2.501,
        lat_V2: 48.599, lon_V2: 2.499
    },
    C: { name: 'Charlie', lat: 48.50, lon: 2.55, type: 'gare' },
    D: { name: 'Delta', lat: 48.40, lon: 2.60, type: 'gare' }
};

const TRAJETS = [{
    id: 'TEST_SUD',
    direction: 'SUD',
    voie: 2,
    points: [
        { id: 'A', durationToNext: 100 },
        { id: 'B', durationToNext: 200 },
        { id: 'BIF', durationToNext: 300 },
        { id: 'C', durationToNext: 400 },
        { id: 'D', durationToNext: 0 }
    ]
}];

function pattern(overrides = {}) {
    return [{
        id: 'P1',
        masterRouteId: 'TEST_SUD',
        startPointId: 'A',
        endPointId: 'D',
        stops: ['A', 'D'],
        ...overrides
    }];
}

describe('buildEffectiveRoute — construction de base', () => {
    it('construit la route dans le sens nominal', () => {
        const r = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern());
        expect(r.points.map(p => p.id)).toEqual(['A', 'B', 'BIF', 'C', 'D']);
        expect(r.direction).toBe('SUD');
        expect(r.points[0].durationEffective).toBe(100);
        expect(r.points[3].durationEffective).toBe(400);
    });

    it('changement de voie : la bifurcation utilise les coordonnées de la voie du trajet', () => {
        const r = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern());
        const bif = r.points.find(p => p.id === 'BIF');
        expect(bif.lat).toBe(48.599); // voie 2
        expect(bif.lon).toBe(2.499);
    });

    it('utilise aussi l’entrée directionnelle d’un ouvrage d’art', () => {
        const pointsWithStructure = {
            ...POINTS,
            C: {
                ...POINTS.C,
                type: 'ouvrage_art',
                lat_V1: 48.501,
                lon_V1: 2.401,
                lat_V2: 48.499,
                lon_V2: 2.399
            }
        };
        const route = buildEffectiveRoute('P1', 0, pointsWithStructure, TRAJETS, pattern());
        expect(route.points.find(point => point.id === 'C')).toMatchObject({ lat: 48.499, lon: 2.399 });
    });

    it('sens inverse : les durées sont lues sur le point d\'arrivée du segment', () => {
        const r = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern({ startPointId: 'D', endPointId: 'A' }));
        expect(r.points.map(p => p.id)).toEqual(['D', 'C', 'BIF', 'B', 'A']);
        expect(r.direction).toBe('NORD');
        // Segment D→C : durée = durationToNext de C (400) en sens inverse
        expect(r.points[0].durationEffective).toBe(400);
    });

    it('lève une erreur claire si pattern ou point introuvable', () => {
        expect(() => buildEffectiveRoute('NOPE', 0, POINTS, TRAJETS, pattern())).toThrow(/Pattern non trouvé/);
        expect(() => buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern({ startPointId: 'ZZZ' }))).toThrow(/introuvable/);
    });
});

describe('pénalité d\'arrêt intermédiaire (360 s : 25% avant / 75% après)', () => {
    it('applique 90 s au segment d\'arrivée et 270 s au segment de départ', () => {
        const withStop = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern({ stops: ['A', 'C', 'D'] }));
        const without = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern());
        // C est le point d'index 3 ; segment 2 (BIF→C) : +90 ; segment 3 (C→D) : +270
        expect(withStop.points[2].durationEffective - without.points[2].durationEffective).toBe(90);
        expect(withStop.points[3].durationEffective - without.points[3].durationEffective).toBe(270);
    });

    it('pas de pénalité sur le départ et le terminus', () => {
        const r = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern());
        expect(r.points[0].durationEffective).toBe(100);
        expect(r.points[4].durationEffective).toBe(0);
    });

    it('marque isStop / isAccelerating / isDecelerating correctement', () => {
        const r = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern({ stops: ['A', 'C', 'D'] }));
        const c = r.points[3];
        expect(c.isStop).toBe(true);
        expect(c.isAccelerating).toBe(true);
        expect(r.points[2].isDecelerating).toBe(true); // BIF précède l'arrêt C
    });
});

describe('ΔT global (retard annoncé)', () => {
    it('répartit le ΔT proportionnellement sur tous les segments', () => {
        const base = buildEffectiveRoute('P1', 0, POINTS, TRAJETS, pattern());
        const delayed = buildEffectiveRoute('P1', 100, POINTS, TRAJETS, pattern());
        const totalBase = base.points.reduce((s, p) => s + p.durationEffective, 0);
        const totalDelayed = delayed.points.reduce((s, p) => s + p.durationEffective, 0);
        expect(totalDelayed - totalBase).toBeCloseTo(100, -1);
    });
});
