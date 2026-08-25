import { describe, it, expect } from 'vitest';
import {
    carHudPointClass,
    speedDisplayKey,
    formatRemainingDistance,
    formatStructureDistance,
    structureProgressPercent,
    tunnelImageHtml
} from '../js/car-ui.js';

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

describe('hiérarchie du carousel voiture', () => {
    const wps = [
        { name: 'Mâcon-Loché TGV', type: 'etape' },      // 0 — départ réel
        { name: 'Péage Mâcon', type: 'peage' },
        { name: 'Sortie 5', type: 'sortie' },
        { name: 'Aire de la Bresse', type: 'aire' },
        { name: 'Viaduc de Poncin', type: 'viaduc' },
        { name: 'Combloux', type: 'etape' }              // 5 — arrivée réelle
    ];
    const last = wps.length - 1;
    const cls = (i) => carHudPointClass(i, 2, wps[i], false, last);

    it('met en avant les péages et les deux extrémités du trajet', () => {
        expect(cls(0)).toContain('stop');   // extrémité, typée etape
        expect(cls(1)).toContain('stop');   // péage
        expect(cls(last)).toContain('stop'); // extrémité, typée etape
    });

    it('laisse le fil de la route discret : sorties, aires, ouvrages', () => {
        expect(cls(2)).not.toContain('stop');
        expect(cls(3)).not.toContain('stop');
        expect(cls(4)).not.toContain('stop');
    });

    it('conserve le rang de proximité et le franchissement d\'ouvrage', () => {
        expect(cls(2)).toContain('active');
        expect(cls(3)).toContain('next');
        expect(cls(4)).toContain('future-1');
        expect(carHudPointClass(3, 2, wps[3], true, last)).toContain('on-structure');
    });
});

describe('stabilité de l\'afficheur de vitesse', () => {
    const tunnel = { inTunnel: true, tunnelName: 'Tunnel de Chamoise', gpsLost: false, speedKmh: 0 };

    it('rend la même clé tant que le tunnel est le même', () => {
        // La boucle de fraîcheur rejoue le rendu 2×/s : sans clé stable,
        // l'image du tunnel serait recréée à chaque passage (scintillement).
        expect(speedDisplayKey(tunnel)).toBe(speedDisplayKey({ ...tunnel }));
    });

    it('change de clé en entrant et en sortant du tunnel', () => {
        const roule = { inTunnel: false, gpsLost: false, speedKmh: 112, speedReliable: true };
        expect(speedDisplayKey(tunnel)).not.toBe(speedDisplayKey(roule));
        expect(speedDisplayKey({ ...tunnel, tunnelName: 'Tunnel du Vuache' })).not.toBe(speedDisplayKey(tunnel));
    });

    it('ne change pas de clé pour une variation sous le km/h affiché', () => {
        const base = { inTunnel: false, gpsLost: false, speedReliable: true };
        expect(speedDisplayKey({ ...base, speedKmh: 112.2 })).toBe(speedDisplayKey({ ...base, speedKmh: 112.4 }));
        expect(speedDisplayKey({ ...base, speedKmh: 112 })).not.toBe(speedDisplayKey({ ...base, speedKmh: 113 }));
    });

    it('distingue le HUD du widget sur une vitesse non fiable', () => {
        const flou = { inTunnel: false, gpsLost: false, speedKmh: 90, speedReliable: false };
        expect(speedDisplayKey(flou, { unreliableAsLost: true })).toBe('lost');
        expect(speedDisplayKey(flou)).toBe('speed:90:?');
    });
});
