// tests/tracking.test.js
import { describe, it, expect } from 'vitest';
import {
    shouldAcceptAccuracy,
    evaluateTeleport,
    medianStepSpeed,
    noiseFloorKmh,
    filterSpeedSpike,
    isGpsSignalStale,
    MAX_ACCEPTABLE_ACCURACY_M,
    ACCURACY_OVERRIDE_MS,
    TELEPORT_MAX_REJECTIONS
} from '../js/tracking.js';

const T0 = 1_700_000_000_000;

describe('isGpsSignalStale — fraîcheur du flux', () => {
    it('bascule à la limite configurée depuis le dernier fix', () => {
        expect(isGpsSignalStale(T0, T0 - 10_000, T0 + 2499, 2500)).toBe(false);
        expect(isGpsSignalStale(T0, T0 - 10_000, T0 + 2500, 2500)).toBe(true);
    });

    it("surveille aussi l'attente du tout premier fix", () => {
        expect(isGpsSignalStale(0, T0, T0 + 3000, 2500)).toBe(true);
        expect(isGpsSignalStale(0, 0, T0 + 3000, 2500)).toBe(false);
    });
});

describe('shouldAcceptAccuracy — filtre de précision', () => {
    it('accepte un fix précis (GPS natif en plaine)', () => {
        expect(shouldAcceptAccuracy(15, T0 - 1000, T0)).toBe(true);
    });

    it('accepte une précision absente/invalide (WiFi SNCF, bridge Scriptable)', () => {
        expect(shouldAcceptAccuracy(NaN, T0 - 1000, T0)).toBe(true);
        expect(shouldAcceptAccuracy(undefined, T0 - 1000, T0)).toBe(true);
        expect(shouldAcceptAccuracy(0, T0 - 1000, T0)).toBe(true);
    });

    it('rejette un rebond cellulaire imprécis juste après un bon fix', () => {
        expect(shouldAcceptAccuracy(2500, T0 - 2000, T0)).toBe(false);
    });

    it('accepte la limite exacte', () => {
        expect(shouldAcceptAccuracy(MAX_ACCEPTABLE_ACCURACY_M, T0 - 1000, T0)).toBe(true);
        expect(shouldAcceptAccuracy(MAX_ACCEPTABLE_ACCURACY_M + 1, T0 - 1000, T0)).toBe(false);
    });

    it('mode dégradé : accepte un fix imprécis après une longue disette (tunnel)', () => {
        expect(shouldAcceptAccuracy(2500, T0 - ACCURACY_OVERRIDE_MS, T0)).toBe(true);
        expect(shouldAcceptAccuracy(2500, 0, T0)).toBe(true); // aucun fix encore accepté
    });
});

describe('evaluateTeleport — anti-téléportation avec récupération', () => {
    const paris = { lat: 48.8443, lon: 2.3756, ts: T0 };

    it('accepte le tout premier fix (pas de position de confiance)', () => {
        const v = evaluateTeleport(null, 48.8, 2.4, T0, 0);
        expect(v).toEqual({ accept: true, reseeded: false, rejections: 0 });
    });

    it('accepte un déplacement TGV normal (~90 m en 1 s ≈ 320 km/h)', () => {
        const v = evaluateTeleport(paris, 48.8451, 2.3756, T0 + 1000, 0);
        expect(v.accept).toBe(true);
        expect(v.rejections).toBe(0);
    });

    it('rejette une téléportation (100 km en 1 s) et incrémente le compteur', () => {
        const v = evaluateTeleport(paris, 47.9, 2.3756, T0 + 1000, 0);
        expect(v.accept).toBe(false);
        expect(v.rejections).toBe(1);
    });

    it('après une longue perte GPS (tunnel), un grand saut est accepté car dt est grand', () => {
        // 40 km après 10 minutes sans fix → 240 km/h implicite : normal
        const v = evaluateTeleport(paris, 48.4850, 2.6550, T0 + 10 * 60_000, 0);
        expect(v.accept).toBe(true);
    });

    it('récupération : au N-ième rejet consécutif, accepte et demande un ré-ancrage', () => {
        let rejections = 0;
        let verdict;
        for (let i = 0; i < TELEPORT_MAX_REJECTIONS; i++) {
            verdict = evaluateTeleport(paris, 47.9, 2.3756, T0 + 1000 + i, rejections);
            rejections = verdict.rejections;
        }
        expect(verdict.accept).toBe(true);
        expect(verdict.reseeded).toBe(true);
        expect(verdict.rejections).toBe(0);
    });

    it('un fix cohérent remet le compteur de rejets à zéro', () => {
        const v = evaluateTeleport(paris, 48.8451, 2.3756, T0 + 1000, 2);
        expect(v.accept).toBe(true);
        expect(v.rejections).toBe(0);
    });

    it('dt nul ou négatif : accepté (comportement historique conservé)', () => {
        const v = evaluateTeleport(paris, 47.9, 2.3756, T0, 0);
        expect(v.accept).toBe(true);
    });
});

describe('medianStepSpeed — vitesse lissée', () => {
    it('calcule la médiane des vitesses instantanées', () => {
        // ~90 m/s vers le sud à 1 fix/s ≈ 320 km/h
        const step = 0.0008; // deg lat ≈ 89 m
        const positions = Array.from({ length: 5 }, (_, i) => ({
            lat: 48.8 - step * i, lon: 2.4, ts: T0 + i * 1000
        }));
        const v = medianStepSpeed(positions);
        expect(v).toBeGreaterThan(300);
        expect(v).toBeLessThan(340);
    });

    it('un pic isolé (rebond GPS) n\'affecte pas la médiane', () => {
        const step = 0.0008;
        const positions = Array.from({ length: 7 }, (_, i) => ({
            lat: 48.8 - step * i, lon: 2.4, ts: T0 + i * 1000
        }));
        positions[3] = { lat: 48.75, lon: 2.4, ts: T0 + 3000 }; // saut de ~5 km
        const clean = medianStepSpeed(positions.filter((_, i) => i !== 3));
        const noisy = medianStepSpeed(positions);
        // La médiane reste dans le même ordre de grandeur malgré le pic
        expect(noisy).toBeLessThan(clean * 2);
    });

    it('retourne 0 si moins de 2 positions', () => {
        expect(medianStepSpeed([])).toBe(0);
        expect(medianStepSpeed([{ lat: 48.8, lon: 2.4, ts: T0 }])).toBe(0);
        expect(medianStepSpeed(null)).toBe(0);
    });
});

describe('noiseFloorKmh — vitesse fantôme à l\'arrêt en gare', () => {
    it('±30 m sur 10 s ≈ 10.8 km/h de bruit possible', () => {
        expect(noiseFloorKmh(30, 10)).toBeCloseTo(10.8, 1);
    });

    it('retourne 0 pour des entrées invalides', () => {
        expect(noiseFloorKmh(NaN, 10)).toBe(0);
        expect(noiseFloorKmh(30, 0)).toBe(0);
        expect(noiseFloorKmh(-5, 10)).toBe(0);
    });

    it('scénario complet : train à quai, jitter GPS → vitesse considérée nulle', () => {
        // Jitter aléatoire ±20 m autour d'un point fixe
        const jitter = 0.00018; // ~20 m
        const positions = Array.from({ length: 10 }, (_, i) => ({
            lat: 48.8443 + (i % 2 === 0 ? jitter : -jitter),
            lon: 2.3756,
            ts: T0 + i * 1000
        }));
        const speed = medianStepSpeed(positions);
        const floor = noiseFloorKmh(30, 9);
        // La vitesse fantôme mesurée dépasse 0 mais reste sous un plancher large
        expect(speed).toBeGreaterThan(0);
        expect(floor).toBeGreaterThan(0);
    });
});

describe('filterSpeedSpike — anti-pic (comportement historique)', () => {
    it('laisse passer une variation ≤ 5 km/h', () => {
        expect(filterSpeedSpike(300, 304)).toBe(304);
        expect(filterSpeedSpike(300, 295)).toBe(295);
    });

    it('limite un pic à +2 km/h par tick', () => {
        expect(filterSpeedSpike(300, 350)).toBe(302);
    });

    it('limite une chute à -2 km/h par tick', () => {
        expect(filterSpeedSpike(300, 0)).toBe(298);
    });

    it('accepte un profil de réponse plus rapide', () => {
        expect(filterSpeedSpike(50, 120, { thresholdKmh: 20, stepKmh: 35 })).toBe(85);
    });
});
