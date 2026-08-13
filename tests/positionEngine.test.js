// tests/positionEngine.test.js
// Moteur de position réutilisable (js/position-engine.js) : vérifie que la
// composition des filtres de tracking.js reproduit bout-en-bout la sémantique
// de la chaîne historique de showPosition (app.js).

import { describe, it, expect } from 'vitest';
import { createPositionEngine } from '../js/position-engine.js';

const T0 = 1_700_000_000_000;

function fix(lat, lon, { accuracy = 15, speed = null } = {}) {
    return { coords: { latitude: lat, longitude: lon, accuracy, speed } };
}

// À 46°N : +0.001° de latitude ≈ 111 m. 0.00027°/s ≈ 108 km/h.
const STEP_108_KMH = 0.00027;

describe('createPositionEngine — filtres d\'entrée', () => {
    it('accepte un fix nominal', () => {
        const engine = createPositionEngine();
        const r = engine.process(fix(46.0, 5.0), T0);
        expect(r.accepted).toBe(true);
        expect(r.lat).toBe(46.0);
        expect(r.speedKmh).toBe(0); // un seul point : pas de vitesse
        expect(r.reseeded).toBe(false);
    });

    it('rejette un fix sans coordonnées valides', () => {
        const engine = createPositionEngine();
        expect(engine.process({ coords: { latitude: NaN, longitude: 5 } }, T0))
            .toMatchObject({ accepted: false, reason: 'invalid' });
    });

    it('rejette un fix imprécis (> 800 m) après un premier fix accepté', () => {
        const engine = createPositionEngine();
        engine.process(fix(46.0, 5.0), T0);
        const r = engine.process(fix(46.001, 5.0, { accuracy: 2500 }), T0 + 1000);
        expect(r).toMatchObject({ accepted: false, reason: 'accuracy', accuracyMeters: 2500 });
    });

    it('mode dégradé : accepte un fix imprécis après 30 s sans fix', () => {
        const engine = createPositionEngine();
        engine.process(fix(46.0, 5.0), T0);
        const r = engine.process(fix(46.001, 5.0, { accuracy: 2500 }), T0 + 31_000);
        expect(r.accepted).toBe(true);
    });

    it('anti-téléportation : rejette un saut impossible, ré-ancre après 3 rejets', () => {
        const engine = createPositionEngine();
        engine.process(fix(46.0, 5.0), T0);
        // Saut de ~110 km en 1 s (~400 000 km/h)
        const jump = () => engine.process(fix(47.0, 5.0), T0 + 1000);
        expect(jump()).toMatchObject({ accepted: false, reason: 'teleport' });
        expect(jump()).toMatchObject({ accepted: false, reason: 'teleport' });
        const third = jump();
        expect(third.accepted).toBe(true);
        expect(third.reseeded).toBe(true); // l'appelant doit ré-ancrer son matching
    });

    it('reset() repart de zéro (plus de position de confiance)', () => {
        const engine = createPositionEngine();
        engine.process(fix(46.0, 5.0), T0);
        engine.reset();
        // Après reset, un fix très éloigné est accepté directement (1er fix)
        const r = engine.process(fix(47.0, 5.0), T0 + 1000);
        expect(r.accepted).toBe(true);
    });
});

describe('createPositionEngine — vitesse', () => {
    it('vitesse médiane sur déplacement régulier, montée limitée par l\'anti-pic', () => {
        const engine = createPositionEngine();
        let last = null;
        for (let i = 0; i < 10; i++) {
            last = engine.process(fix(46.0 + i * STEP_108_KMH, 5.0), T0 + i * 1000);
        }
        // La médiane vaut ~108 km/h mais l'anti-pic historique limite la
        // montée à +2 km/h par tick : après 9 pas ≥ ~16 km/h et croissante.
        expect(last.accepted).toBe(true);
        expect(last.speedKmh).toBeGreaterThan(10);
        expect(last.speedKmh).toBeLessThan(108);
        expect(last.speedReliable).toBe(true);
    });

    it('plancher de bruit : jitter à l\'arrêt → vitesse nulle', () => {
        const engine = createPositionEngine();
        let last = null;
        // Jitter ±3 m avec précision 30 m : la vitesse fantôme médiane
        // (~16 km/h) est sous le plancher de bruit (30 m / 5 s ≈ 21,6 km/h)
        const jitter = [0, 0.00003, -0.00002, 0.00001, -0.00003, 0.00002];
        for (let i = 0; i < jitter.length; i++) {
            last = engine.process(fix(46.0 + jitter[i], 5.0, { accuracy: 30 }), T0 + i * 1000);
        }
        expect(last.speedKmh).toBe(0);
    });

    it('vitesse directe de la source si trustReportedSpeed (WiFi SNCF)', () => {
        const engine = createPositionEngine({ trustReportedSpeed: true });
        const r = engine.process(fix(46.0, 5.0, { speed: 250 }), T0);
        expect(r.speedKmh).toBe(250);
        expect(r.speedReliable).toBe(true);
    });

    it('clamp de vitesse configurable (150 km/h en mode voiture)', () => {
        const engine = createPositionEngine({ trustReportedSpeed: true, maxSpeedKmh: 150 });
        engine.process(fix(46.0, 5.0, { speed: 149 }), T0);
        const r = engine.process(fix(46.001, 5.0, { speed: 152 }), T0 + 1000);
        expect(r.speedKmh).toBeLessThanOrEqual(150);
    });

    it('speedDivisor : corrige la vitesse en simulation accélérée (fakeGeoSim)', () => {
        const engine = createPositionEngine({ trustReportedSpeed: true, speedDivisor: () => 15 });
        const r = engine.process(fix(46.0, 5.0, { speed: 150 }), T0);
        expect(r.speedKmh).toBeCloseTo(10);
    });

    it('profil voiture : convertit les m/s et suit immédiatement la vitesse GPS native', () => {
        const engine = createPositionEngine({
            trustReportedSpeed: true,
            reportedSpeedMultiplier: 3.6,
            filterReportedSpeed: false,
            maxSpeedKmh: 160
        });
        engine.process(fix(46.0, 5.0, { speed: 5 }), T0);
        const r = engine.process(fix(46.0002, 5.0, { speed: 30 }), T0 + 1000);
        expect(r.speedKmh).toBeCloseTo(108);
    });

    it('peut exclure la vitesse native du diviseur de simulation', () => {
        const engine = createPositionEngine({
            trustReportedSpeed: true,
            reportedSpeedMultiplier: 3.6,
            divideReportedSpeed: false,
            speedDivisor: () => 10
        });
        const r = engine.process(fix(46.0, 5.0, { speed: 30 }), T0);
        expect(r.speedKmh).toBeCloseTo(108);
    });

    it('retombe sur les positions quand coords.speed vaut null', () => {
        const engine = createPositionEngine({
            trustReportedSpeed: true,
            reportedSpeedMultiplier: 3.6,
            historySize: 3,
            speedSpikeStepKmh: 35,
            speedSpikeThresholdKmh: 20
        });
        engine.process(fix(46.0, 5.0, { speed: null }), T0);
        const r = engine.process(fix(46.0 + STEP_108_KMH, 5.0, { speed: null }), T0 + 1000);
        expect(r.speedReliable).toBe(true);
        expect(r.speedKmh).toBeGreaterThan(30);
    });
});
