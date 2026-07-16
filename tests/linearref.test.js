// tests/linearref.test.js
// Référencement linéaire PK (js/linearref.js) : construction de corridor,
// localisation par réutilisation du matcher existant, interpolation de PK.
// Corridor synthétique OUEST-EST (cas A40) : prouve que le matching
// fonctionne sans aucune logique cardinale (fallback latitude désactivé).

import { describe, it, expect } from 'vitest';
import { buildCorridor, locateOnCorridor, formatPk } from '../js/linearref.js';

// Corridor ouest-est à latitude constante 46.2°N : 50 points espacés
// d'environ 1.4 km (0.018° de longitude), PK de 0 à 68.6.
function makeCorridorPoints() {
    const points = [];
    for (let i = 0; i < 50; i++) {
        points.push({ pk: i * 1.4, lat: 46.2, lon: 5.0 + i * 0.018, line: 'A40' });
    }
    return points;
}

describe('buildCorridor', () => {
    it('construit points + distances cumulées monotones', () => {
        const corridor = buildCorridor(makeCorridorPoints());
        expect(corridor.points).toHaveLength(50);
        expect(corridor.cumKm[0]).toBe(0);
        for (let i = 1; i < corridor.cumKm.length; i++) {
            expect(corridor.cumKm[i]).toBeGreaterThan(corridor.cumKm[i - 1]);
        }
        expect(corridor.totalKm).toBeCloseTo(corridor.cumKm[49]);
        expect(corridor.pkStart).toBe(0);
        expect(corridor.pkEnd).toBeCloseTo(49 * 1.4);
    });

    it('filtre les points invalides et les doublons', () => {
        const corridor = buildCorridor([
            { pk: 0, lat: 46.2, lon: 5.0 },
            { pk: NaN, lat: 46.2, lon: 5.1 },          // pk invalide
            { pk: 1, lat: undefined, lon: 5.1 },       // lat invalide
            null,
            { pk: 2, lat: 46.2, lon: 5.0 },            // doublon géométrique du 1er
            { pk: 3, lat: 46.2, lon: 5.05 }
        ]);
        expect(corridor.points).toHaveLength(2);
        expect(corridor.points.map(p => p.pk)).toEqual([0, 3]);
    });

    it('corridor vide → structure vide sans crash', () => {
        const corridor = buildCorridor([]);
        expect(corridor.points).toHaveLength(0);
        expect(corridor.totalKm).toBe(0);
        expect(corridor.pkStart).toBeNull();
    });
});

describe('locateOnCorridor', () => {
    const corridor = buildCorridor(makeCorridorPoints());

    it('localise une position sur le corridor et interpole le PK', () => {
        // Milieu du segment 10 (entre lon 5.18 et 5.198)
        const loc = locateOnCorridor(corridor, 46.2, 5.189, null, 15);
        expect(loc).not.toBeNull();
        expect(loc.index).toBe(10);
        expect(loc.pk).toBeCloseTo(10 * 1.4 + 0.7, 1);
        expect(loc.line).toBe('A40');
        expect(loc.distanceFromStartKm).toBeGreaterThan(corridor.cumKm[10]);
        expect(loc.distanceToEndKm).toBeCloseTo(corridor.totalKm - loc.distanceFromStartKm);
        expect(loc.offsetKm).toBeLessThan(0.1);
    });

    it('utilise la fenêtre autour de lastIndex (progression normale)', () => {
        const loc = locateOnCorridor(corridor, 46.2, 5.21, 10, 15);
        expect(loc.index).toBe(11);
    });

    it("position loin du corridor → null (PAS de fallback latitude : corridor ouest-est)", () => {
        // 46.2 - 0.5 ≈ 55 km au sud du corridor, mais DANS ses bornes de
        // longitude : un fallback cardinal inventerait un faux matching.
        const loc = locateOnCorridor(corridor, 45.7, 5.4, null, 15);
        expect(loc).toBeNull();
    });

    it('tolère une discontinuité de PK (raccord de lignes) sans contaminer les voisins', () => {
        const pts = [
            { pk: 10.0, lat: 46.2, lon: 5.000 },
            { pk: 11.0, lat: 46.2, lon: 5.013 },
            { pk: 110.0, lat: 46.2, lon: 5.026 }, // saut de PK au raccord
            { pk: 111.0, lat: 46.2, lon: 5.039 }
        ];
        const c = buildCorridor(pts);
        // Sur le segment AVANT le saut : PK interpolé entre 10 et 11
        const before = locateOnCorridor(c, 46.2, 5.0065, null, 15);
        expect(before.pk).toBeGreaterThanOrEqual(10);
        expect(before.pk).toBeLessThanOrEqual(11);
        // Sur le segment APRÈS le saut : PK interpolé entre 110 et 111
        const after = locateOnCorridor(c, 46.2, 5.0325, null, 15);
        expect(after.pk).toBeGreaterThanOrEqual(110);
        expect(after.pk).toBeLessThanOrEqual(111);
    });

    it('expose la vitesse limite (vmax) du segment matché, null si inconnue', () => {
        const pts = makeCorridorPoints().map((p, i) => ({ ...p, vmax: i === 10 ? 300 : undefined }));
        const c = buildCorridor(pts);
        // Milieu du segment 10 : vmax vient de son point de départ
        const withVmax = locateOnCorridor(c, 46.2, 5.189, null, 15);
        expect(withVmax.vmax).toBe(300);
        // Segment 11 : pas de vmax renseignée → null
        const withoutVmax = locateOnCorridor(c, 46.2, 5.21, 10, 15);
        expect(withoutVmax.vmax).toBeNull();
    });

    it('corridor invalide ou coordonnées invalides → null', () => {
        expect(locateOnCorridor(null, 46.2, 5.1)).toBeNull();
        expect(locateOnCorridor(buildCorridor([]), 46.2, 5.1)).toBeNull();
        expect(locateOnCorridor(corridor, NaN, 5.1)).toBeNull();
    });
});

describe('formatPk', () => {
    it('formate en notation km+mètres', () => {
        expect(formatPk(123.456)).toBe('123+456');
        expect(formatPk(0.05)).toBe('0+050');
        expect(formatPk(7)).toBe('7+000');
    });

    it('arrondit correctement au mètre (y compris le passage au km suivant)', () => {
        expect(formatPk(12.9996)).toBe('13+000');
        expect(formatPk(12.0004)).toBe('12+000');
    });

    it('valeur non finie → chaîne vide', () => {
        expect(formatPk(NaN)).toBe('');
        expect(formatPk(undefined)).toBe('');
    });
});
