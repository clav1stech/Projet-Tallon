import { describe, expect, it } from 'vitest';
import {
    buildRouteSegments,
    classifySpeed,
    formatDuration,
    parseDurationInput,
    parsePK,
    pkSegmentLength,
    routePointCoordinates,
    summarizeRouteSegments
} from '../js/route-speed.js';

// Trois points plein sud, ~11,1 km par segment (0,1° de latitude).
const points = {
    A: { name: 'A', type: 'gare', lat: 46.0, lon: 4.8, code_ligne: '752000', PK: '100,000' },
    B: {
        name: 'B', type: 'bifurcation', lat: 45.9, lon: 4.8, lat_V2: 45.8, lon_V2: 4.8,
        code_ligne: '752000', code_ligne_2: '752330',
        PK_V1: '111,200', PK_V2: '111,200', PK_2_V1: '380,000', PK_2_V2: '380,000'
    },
    C: { name: 'C', type: 'gare', lat: 45.8, lon: 4.8, code_ligne: '752330', PK: '391,000' }
};

const route = (voie, durations) => ({
    id: 'R', voie,
    points: [{ id: 'A', durationToNext: durations[0] }, { id: 'B', durationToNext: durations[1] }, { id: 'C' }]
});

describe('coordonnées et PK', () => {
    it('prend l’entrée propre à la voie, comme buildEffectiveRoute', () => {
        expect(routePointCoordinates(points.B, 1)).toEqual({ lat: 45.9, lon: 4.8 });
        expect(routePointCoordinates(points.B, 2)).toEqual({ lat: 45.8, lon: 4.8 });
    });

    it('lit les PK en mètres dans tous les formats SNCF', () => {
        expect(parsePK('123,456')).toBe(123456);
        expect(parsePK('123.456')).toBe(123456);
        expect(parsePK('123+456')).toBe(123456);
        expect(parsePK('0')).toBe(0);
        expect(parsePK('4,23')).toBe(4230);
        expect(parsePK('')).toBeNull();
        expect(parsePK(null)).toBeNull();
    });

    it('mesure par la ligne commune et privilégie le changement de ligne', () => {
        expect(pkSegmentLength(points.A, points.B, 1)).toEqual({ meters: 11200, lineCode: '752000', isLineChange: false });
        expect(pkSegmentLength(points.B, points.C, 1)).toEqual({ meters: 11000, lineCode: '752330', isLineChange: true });
        expect(pkSegmentLength(points.A, points.C, 1)).toBeNull();
    });
});

describe('segments et plausibilité', () => {
    it('cumule distances et durées et calcule la vitesse moyenne', () => {
        const segments = buildRouteSegments(points, route(1, [150, 150]));
        expect(segments).toHaveLength(2);
        expect(segments[0].distanceKm).toBeCloseTo(11.12, 1);
        expect(segments[0].speedKmh).toBeCloseTo(266.9, 0);
        expect(segments[1].startKm).toBeCloseTo(segments[0].distanceKm, 6);
        expect(segments[1].startS).toBe(150);
        expect(segments.every(segment => segment.status === 'ok')).toBe(true);
    });

    it('mesure la voie 2 entre ses propres entrées', () => {
        const [first, second] = buildRouteSegments(points, route(2, [150, 150]));
        expect(first.distanceKm).toBeCloseTo(22.24, 1);
        expect(second.distanceKm).toBeCloseTo(0, 6);
    });

    it('signale les durées impossibles, trop longues et absentes', () => {
        expect(classifySpeed(400, 20)).toBe('too-fast');
        expect(classifySpeed(12, 280)).toBe('too-slow');
        expect(classifySpeed(null, 0)).toBe('no-duration');
        expect(classifySpeed(250, 100)).toBe('ok');
        expect(classifySpeed(250, 100, { min: 0, max: 200 })).toBe('too-fast');

        const segments = buildRouteSegments(points, route(1, [20, 0]));
        expect(segments.map(segment => segment.status)).toEqual(['too-fast', 'no-duration']);
        const summary = summarizeRouteSegments(segments);
        expect(summary.anomalies).toHaveLength(2);
        expect(summary.totalS).toBe(20);
    });
});

describe('saisie et affichage des durées', () => {
    it.each([
        ['245', 245], ['245 s', 245], ['4:05', 245], ['4 min 05', 245], ['4m05s', 245], ['4 min', 240], [' 90 ', 90]
    ])('« %s » vaut %i s', (input, expected) => {
        expect(parseDurationInput(input)).toBe(expected);
    });

    it.each(['', 'abc', '4:75', '-3'])('refuse « %s »', input => {
        expect(parseDurationInput(input)).toBeNull();
    });

    it('formate en m:ss puis h:mm:ss', () => {
        expect(formatDuration(245)).toBe('4:05');
        expect(formatDuration(7052)).toBe('1:57:32');
        expect(formatDuration(0)).toBe('0:00');
    });
});
