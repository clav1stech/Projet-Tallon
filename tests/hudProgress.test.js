// tests/hudProgress.test.js
// Repères de progression continue de l'affichage : avancement sur le segment
// courant (tête de lecture, liseré) et retard retenu pour les heures projetées.

import { describe, it, expect } from 'vitest';
import { computeSegmentRatio } from '../js/functions.js';
import {
    alignDelayForDisplay,
    EARLY_DISPLAY_THRESHOLD_MS,
    LATE_DISPLAY_THRESHOLD_MS
} from '../js/utils.js';

describe('computeSegmentRatio', () => {
    it('rend la part parcourue du segment', () => {
        expect(computeSegmentRatio(3, 1)).toBeCloseTo(0.75, 6);
        expect(computeSegmentRatio(0, 5)).toBe(0);
        expect(computeSegmentRatio(5, 0)).toBe(1);
    });

    it('segment de longueur nulle : pas de division par zéro', () => {
        expect(computeSegmentRatio(0, 0)).toBe(0);
    });

    it('borne les distances aberrantes à [0, 1]', () => {
        expect(computeSegmentRatio(-4, 2)).toBe(0);
        expect(computeSegmentRatio(2, -4)).toBe(1);
        expect(computeSegmentRatio(NaN, 3)).toBe(0);
        expect(computeSegmentRatio(3, undefined)).toBe(1);
    });
});

describe('alignDelayForDisplay', () => {
    it('ignore un écart sous les seuils d\'affichage', () => {
        expect(alignDelayForDisplay(45_000)).toBe(0);
        expect(alignDelayForDisplay(LATE_DISPLAY_THRESHOLD_MS)).toBe(0);
        expect(alignDelayForDisplay(-120_000)).toBe(0);
        expect(alignDelayForDisplay(EARLY_DISPLAY_THRESHOLD_MS)).toBe(0);
    });

    it('aligne sur la minute entière, comme la pilule du HUD', () => {
        expect(alignDelayForDisplay(3 * 60_000 + 45_000)).toBe(3 * 60_000);
        expect(alignDelayForDisplay(-4 * 60_000 - 50_000)).toBe(-4 * 60_000);
    });

    it('entrée invalide : aucun décalage', () => {
        expect(alignDelayForDisplay(NaN)).toBe(0);
        expect(alignDelayForDisplay(null)).toBe(0);
    });
});
