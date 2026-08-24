import { describe, it, expect } from 'vitest';
import {
    formatRemainingDistance,
    formatStructureDistance,
    structureProgressPercent,
    tunnelImageHtml
} from '../js/car-ui.js';

describe('formatRemainingDistance', () => {
    it('affiche les kilomètres restants avec une décimale', () => {
        expect(formatRemainingDistance(123.456)).toBe('123.5 km');
        expect(formatRemainingDistance(0)).toBe('0.0 km');
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

describe('affichage du franchissement d\'un ouvrage', () => {
    it('bascule en mètres sous le kilomètre', () => {
        expect(formatStructureDistance(0.482)).toBe('482 m');
        expect(formatStructureDistance(1.25)).toBe('1.3 km');
        expect(formatStructureDistance(-1)).toBe('—');
    });

    it('borne la jauge de franchissement entre 0 et 100 %', () => {
        expect(structureProgressPercent(0.42)).toBeCloseTo(42, 6);
        expect(structureProgressPercent(1.4)).toBe(100);
        expect(structureProgressPercent(-0.2)).toBe(0);
        expect(structureProgressPercent(null)).toBe(0);
    });
});
