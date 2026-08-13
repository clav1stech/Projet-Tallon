import { describe, it, expect } from 'vitest';
import { formatRemainingDistance } from '../js/car-ui.js';

describe('formatRemainingDistance', () => {
    it('affiche les kilomètres restants avec une décimale', () => {
        expect(formatRemainingDistance(123.456)).toBe('123.5 km');
        expect(formatRemainingDistance(0)).toBe('0.0 km');
    });

    it('rejette une distance invalide', () => {
        expect(formatRemainingDistance(NaN)).toBe('—');
        expect(formatRemainingDistance(-1)).toBe('—');
    });
});
