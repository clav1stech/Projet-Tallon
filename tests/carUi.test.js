import { describe, it, expect } from 'vitest';
import { formatRemainingDistance, tunnelImageHtml } from '../js/car-ui.js';

describe('formatRemainingDistance', () => {
    it('affiche les kilomètres restants avec une décimale', () => {
        expect(formatRemainingDistance(123.456)).toBe('123 km');
        expect(formatRemainingDistance(123.6)).toBe('124 km');
        expect(formatRemainingDistance(0)).toBe('0 km');
    });

    it('rejette une distance invalide', () => {
        expect(formatRemainingDistance(NaN)).toBe('—');
        expect(formatRemainingDistance(-1)).toBe('—');
    });

    it("utilise l'image dédiée pendant une traversée de tunnel", () => {
        expect(tunnelImageHtml('hud-tunnel-image')).toBe(
            '<img src="assets/tunnel.png" class="tunnel-image hud-tunnel-image" alt="Tunnel">'
        );
    });
});
