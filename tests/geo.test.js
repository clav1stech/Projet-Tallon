// tests/geo.test.js
// Primitives géométriques pures (js/geo.js).

import { describe, it, expect } from 'vitest';
import { buildCumulativeDistances, haversineDistance } from '../js/geo.js';

describe('buildCumulativeDistances', () => {
    const points = [
        { lat: 46.0, lon: 5.0 },
        { lat: 46.1, lon: 5.0 },
        { lat: 46.2, lon: 5.0 }
    ];

    it('cumule les distances le long de la polyligne', () => {
        const cumKm = buildCumulativeDistances(points);
        expect(cumKm).toHaveLength(points.length);
        expect(cumKm[0]).toBe(0);
        expect(cumKm[1]).toBeCloseTo(haversineDistance(46.0, 5.0, 46.1, 5.0), 9);
        expect(cumKm[2]).toBeCloseTo(cumKm[1] * 2, 4);
    });

    it('croissance stricte sur des points distincts', () => {
        const cumKm = buildCumulativeDistances(points);
        for (let i = 1; i < cumKm.length; i++) {
            expect(cumKm[i]).toBeGreaterThan(cumKm[i - 1]);
        }
    });

    it('cas dégénérés : liste vide ou point unique', () => {
        expect(buildCumulativeDistances([])).toEqual([]);
        expect(buildCumulativeDistances(null)).toEqual([]);
        expect(buildCumulativeDistances([{ lat: 46, lon: 5 }])).toEqual([0]);
    });
});
