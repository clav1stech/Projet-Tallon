// Tests des fonctions pures du simulateur GPS de dev (js/fakeGeoSim.js).
// Le runtime navigateur (surcharge de navigator.geolocation) est inerte en
// node : l'import du module est sans effet de bord ici.

import { describe, it, expect } from 'vitest';
import {
    parseFakeGpsConfig,
    computeSimPosition,
    computeElapsedToTarget,
    routeTotalDurationMs
} from '../js/fakeGeoSim.js';

// Durées en secondes (comme durationEffective de buildEffectiveRoute) :
// A --60s--> B --120s--> C, total 180 s.
const ROUTE = [
    { id: 'A', name: 'Alpha', lat: 0, lon: 0, durationEffective: 60 },
    { id: 'B', name: 'Bravo', lat: 1, lon: 0, durationEffective: 120 },
    { id: 'C', name: 'Charlie', lat: 1, lon: 1 }
];

describe('parseFakeGpsConfig', () => {
    it('retourne null sans paramètre fakegps (simulation inerte par défaut)', () => {
        expect(parseFakeGpsConfig('')).toBeNull();
        expect(parseFakeGpsConfig('?foo=1')).toBeNull();
    });

    it('?fakegps seul active avec le multiplicateur par défaut', () => {
        const cfg = parseFakeGpsConfig('?fakegps');
        expect(cfg).toEqual({ multiplier: 15, pace: 1, delayMinutes: 0, start: null });
    });

    it('lit multiplicateur, retard, allure et point de départ', () => {
        const cfg = parseFakeGpsConfig('?fakegps=30&fakedelay=5&fakepace=0.9&fakestart=MACON_LOCHE');
        expect(cfg).toEqual({ multiplier: 30, pace: 0.9, delayMinutes: 5, start: 'MACON_LOCHE' });
    });

    it('accepte un retard négatif (avance)', () => {
        expect(parseFakeGpsConfig('?fakegps=1&fakedelay=-3').delayMinutes).toBe(-3);
    });

    it('retourne null pour un multiplicateur invalide ou nul', () => {
        expect(parseFakeGpsConfig('?fakegps=0')).toBeNull();
        expect(parseFakeGpsConfig('?fakegps=-5')).toBeNull();
        expect(parseFakeGpsConfig('?fakegps=abc')).toBeNull();
    });

    it('ignore une allure invalide (retombe sur 1)', () => {
        expect(parseFakeGpsConfig('?fakegps=1&fakepace=0').pace).toBe(1);
        expect(parseFakeGpsConfig('?fakegps=1&fakepace=xyz').pace).toBe(1);
    });
});

describe('routeTotalDurationMs', () => {
    it('somme les durées de segments (le dernier point ne compte pas)', () => {
        expect(routeTotalDurationMs(ROUTE)).toBe(180000);
    });

    it('retourne 0 pour une route vide ou à un seul point', () => {
        expect(routeTotalDurationMs([])).toBe(0);
        expect(routeTotalDurationMs([ROUTE[0]])).toBe(0);
    });

    it('utilise baseDurationToNext en secours de durationEffective', () => {
        const route = [
            { id: 'A', lat: 0, lon: 0, baseDurationToNext: 30 },
            { id: 'B', lat: 1, lon: 1 }
        ];
        expect(routeTotalDurationMs(route)).toBe(30000);
    });
});

describe('computeSimPosition', () => {
    it('retourne null sans route', () => {
        expect(computeSimPosition(null, 0)).toBeNull();
        expect(computeSimPosition([], 0)).toBeNull();
    });

    it('à t=0 : au point de départ', () => {
        const pos = computeSimPosition(ROUTE, 0);
        expect(pos.latitude).toBe(0);
        expect(pos.longitude).toBe(0);
        expect(pos.segmentIndex).toBe(0);
        expect(pos.finished).toBe(false);
    });

    it('interpole linéairement au milieu du premier segment', () => {
        const pos = computeSimPosition(ROUTE, 30000);
        expect(pos.latitude).toBeCloseTo(0.5, 10);
        expect(pos.longitude).toBe(0);
        expect(pos.segmentIndex).toBe(0);
    });

    it('bascule sur le segment suivant à la fin du premier', () => {
        const pos = computeSimPosition(ROUTE, 60000);
        expect(pos.latitude).toBe(1);
        expect(pos.segmentIndex).toBe(1);
        expect(pos.finished).toBe(false);
    });

    it('un temps négatif est clampé au départ', () => {
        const pos = computeSimPosition(ROUTE, -5000);
        expect(pos.latitude).toBe(0);
        expect(pos.segmentIndex).toBe(0);
    });

    it('au-delà de la durée totale : terminus, finished=true', () => {
        const pos = computeSimPosition(ROUTE, 999999);
        expect(pos.latitude).toBe(1);
        expect(pos.longitude).toBe(1);
        expect(pos.finished).toBe(true);
    });
});

describe('computeElapsedToTarget', () => {
    it('cible par id de point', () => {
        expect(computeElapsedToTarget(ROUTE, 'B')).toBe(60000);
        expect(computeElapsedToTarget(ROUTE, 'C')).toBe(180000);
    });

    it('cible par nom, insensible à la casse', () => {
        expect(computeElapsedToTarget(ROUTE, 'bravo')).toBe(60000);
    });

    it('cible en pourcentage du trajet (nombre ou chaîne)', () => {
        expect(computeElapsedToTarget(ROUTE, 50)).toBe(90000);
        expect(computeElapsedToTarget(ROUTE, '50')).toBe(90000);
        expect(computeElapsedToTarget(ROUTE, 0)).toBe(0);
        expect(computeElapsedToTarget(ROUTE, 100)).toBe(180000);
    });

    it('clampe le pourcentage hors bornes', () => {
        expect(computeElapsedToTarget(ROUTE, 150)).toBe(180000);
        expect(computeElapsedToTarget(ROUTE, -10)).toBe(0);
    });

    it('retourne null pour une cible introuvable ou une route vide', () => {
        expect(computeElapsedToTarget(ROUTE, 'ZZZ')).toBeNull();
        expect(computeElapsedToTarget([], 'A')).toBeNull();
        expect(computeElapsedToTarget(ROUTE, null)).toBeNull();
    });
});
