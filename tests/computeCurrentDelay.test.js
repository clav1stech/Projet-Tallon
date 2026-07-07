// tests/computeCurrentDelay.test.js
import { describe, it, expect } from 'vitest';
import { computeCurrentDelay } from '../js/functions.js';
import { southboundRoute } from './fixtures.js';

// Chaque segment de la fixture dure 120 s.
const SEG_MS = 120_000;

describe('computeCurrentDelay — cas nominal', () => {
    it('retard ~0 quand le train est pile à l\'heure', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const segLen = route[2].segmentLengthToNext;
        // Milieu du segment 2 (segment "libre" : pas d'easing arrêt) à t = 2.5 segments
        const now = dep + 2 * SEG_MS + SEG_MS / 2;
        const delay = computeCurrentDelay(route, 2, segLen / 2, dep, now);
        expect(Math.abs(delay)).toBeLessThan(1000);
    });

    it('retard positif quand le train est en retard', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const now = dep + 4 * SEG_MS; // devrait être au début du segment 4
        const delay = computeCurrentDelay(route, 2, 0, dep, now); // encore au début du 2
        expect(delay).toBeCloseTo(2 * SEG_MS, -3);
    });

    it('retard négatif (avance) quand le train est en avance', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const now = dep + 1 * SEG_MS; // horaire : début du segment 1
        const delay = computeCurrentDelay(route, 3, 0, dep, now); // déjà au segment 3
        expect(delay).toBeLessThan(0);
        expect(delay).toBeCloseTo(-2 * SEG_MS, -3);
    });
});

describe('cas limite : arrivée en avance au terminus', () => {
    it('l\'avance au terminus est correctement négative', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const totalMs = 8 * SEG_MS;
        const now = dep + totalMs - 3 * 60_000; // 3 min d'avance
        const lastSegIdx = route.length - 2;
        const segLen = route[lastSegIdx].segmentLengthToNext;
        const delay = computeCurrentDelay(route, lastSegIdx, segLen, dep, now);
        expect(delay).toBeCloseTo(-3 * 60_000, -4);
    });
});

describe('robustesse des entrées', () => {
    it('ne crashe pas et clampe un segmentIndex hors bornes (terminus affiché)', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const now = dep + 8 * SEG_MS;
        // index = route.length - 1 (dernier POINT, pas dernier segment)
        const delay = computeCurrentDelay(route, route.length - 1, 0, dep, now);
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeCloseTo(0, -3);
        // index largement hors bornes
        expect(Number.isFinite(computeCurrentDelay(route, 999, 0, dep, now))).toBe(true);
    });

    it('retourne 0 pour des entrées invalides', () => {
        const route = southboundRoute();
        expect(computeCurrentDelay(null, 0, 0, 1000, 2000)).toBe(0);
        expect(computeCurrentDelay([], 0, 0, 1000, 2000)).toBe(0);
        expect(computeCurrentDelay(route, null, 0, 1000, 2000)).toBe(0);
        expect(computeCurrentDelay(route, -1, 0, 1000, 2000)).toBe(0);
        expect(computeCurrentDelay(route, NaN, 0, 1000, 2000)).toBe(0);
        expect(computeCurrentDelay(route, 2, 0, null, 2000)).toBe(0);
    });

    it('une distanceFromStart NaN est traitée comme 0 (pas de NaN propagé)', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const delay = computeCurrentDelay(route, 2, NaN, dep, dep + 2 * SEG_MS);
        expect(Number.isFinite(delay)).toBe(true);
    });

    it('une distanceFromStart > longueur du segment est clampée (ratio ≤ 1)', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        const now = dep + 3 * SEG_MS;
        const clamped = computeCurrentDelay(route, 2, 9999, dep, now);
        const atEnd = computeCurrentDelay(route, 2, route[2].segmentLengthToNext, dep, now);
        expect(clamped).toBeCloseTo(atEnd, 5);
    });
});

describe('cas limite : entrée en gare à faible vitesse (easing)', () => {
    it('easing de décélération : le temps théorique avance moins vite en début de segment', () => {
        const route = southboundRoute();
        const dep = 1_000_000;
        // Segment 3 → P4 est une gare (isDecelerating sur le point 3)
        expect(route[3].isDecelerating).toBe(true);
        const segLen = route[3].segmentLengthToNext;
        const now = dep + 3 * SEG_MS + SEG_MS / 2; // mi-temps du segment 3
        // À mi-distance, l'easing 1-sqrt(1-r) donne un temps théorique < 50%
        // du segment → le retard apparent est PLUS GRAND qu'en linéaire.
        const delayEased = computeCurrentDelay(route, 3, segLen / 2, dep, now);
        const delayLinearRef = computeCurrentDelay(route, 2, route[2].segmentLengthToNext / 2, dep, dep + 2 * SEG_MS + SEG_MS / 2);
        expect(delayEased).toBeGreaterThan(delayLinearRef);
    });

    it('easing d\'accélération au départ d\'une gare : sqrt(ratio)', () => {
        const route = southboundRoute();
        expect(route[4].isAccelerating).toBe(true);
        const dep = 1_000_000;
        const segLen = route[4].segmentLengthToNext;
        // À 25% de distance, sqrt(0.25)=0.5 → 50% du temps théorique écoulé
        const now = dep + 4 * SEG_MS + SEG_MS / 2;
        const delay = computeCurrentDelay(route, 4, segLen * 0.25, dep, now);
        expect(Math.abs(delay)).toBeLessThan(1000);
    });
});
