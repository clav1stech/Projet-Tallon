import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCorridor } from '../js/linearref.js';
import {
    applyStructureEndpointSuggestions,
    loadRailCorridors,
    projectStructureEndpoint,
    snapToRailCorridor,
    structureLengthMeters,
    structurePathOnCorridor,
    validateStructureEndpoints
} from '../js/train-structure-endpoints.js';

const curvedCorridor = buildCorridor([
    { pk: 0, lat: 0, lon: 0, line: 'L' },
    { pk: 1.1, lat: 0, lon: 0.01, line: 'L' },
    { pk: 2.2, lat: 0.01, lon: 0.01, line: 'L' }
]);

describe('extrémités directionnelles des ouvrages rail', () => {
    it('lit une longueur explicite ou présente dans le nom', () => {
        expect(structureLengthMeters({ longueur: 420, name: 'Viaduc' })).toBe(420);
        expect(structureLengthMeters({ longueur: null, name: 'Tunnel (2 340 m)' })).toBe(2340);
        expect(structureLengthMeters({ longueur: null, name: 'Tunnel sans longueur' })).toBeNull();
    });

    it('avance sur la polyline et suit sa courbe au lieu de tracer une corde', () => {
        const point = { type: 'ouvrage_art', name: 'Tunnel', longueur: 1600, lat: 0, lon: 0 };
        const projection = projectStructureEndpoint(point, curvedCorridor);
        expect(projection.lon).toBeCloseTo(0.01, 4);
        expect(projection.lat).toBeGreaterThan(0);
        expect(projection.path.some(coordinate => coordinate.lat === 0 && coordinate.lon === 0.01)).toBe(true);
    });

    it('matérialise V1 et la suggestion V2 sans toucher aux autres points', () => {
        const points = {
            TUNNEL: {
                type: 'ouvrage_art', name: 'Tunnel (1 600 m)', longueur: null,
                code_ligne: 'L', lat: 0, lon: 0
            },
            GARE: { type: 'gare', name: 'Gare', lat: 1, lon: 1 }
        };
        const suggestions = applyStructureEndpointSuggestions(points, new Map([['L', curvedCorridor]]));
        expect(suggestions.has('TUNNEL')).toBe(true);
        expect(points.TUNNEL).toMatchObject({ lat_V1: 0, lon_V1: 0, longueur: 1600 });
        expect(points.TUNNEL.lat_V2).toBeGreaterThan(0);
        expect(points.GARE).toEqual({ type: 'gare', name: 'Gare', lat: 1, lon: 1 });
    });

    it('reconstruit le tracé entre deux extrémités corrigées via la polyline', () => {
        const point = {
            type: 'ouvrage_art', lat: 0, lon: 0,
            lat_V1: 0, lon_V1: 0.002,
            lat_V2: 0.004, lon_V2: 0.01
        };
        const path = structurePathOnCorridor(point, curvedCorridor);
        expect(path[0]).toEqual({ lat: 0, lon: 0.002 });
        expect(path.at(-1)).toEqual({ lat: 0.004, lon: 0.01 });
        expect(path.some(coordinate => coordinate.lat === 0 && coordinate.lon === 0.01)).toBe(true);
    });

    it('recolle une correction manuelle sur la polyline', () => {
        const snapped = snapToRailCorridor(curvedCorridor, 0.001, 0.005);
        expect(snapped.lat).toBeCloseTo(0, 6);
        expect(snapped.lon).toBeCloseTo(0.005, 6);
        expect(snapped.offsetKm).toBeGreaterThan(0);
    });

    it('refuse un export avec une entrée manquante ou deux entrées confondues', () => {
        const result = validateStructureEndpoints({
            MANQUANT: { type: 'ouvrage_art', name: 'Tunnel A', lat_V1: 1, lon_V1: 1 },
            CONFONDU: {
                type: 'ouvrage_art', name: 'Tunnel B',
                lat_V1: 1, lon_V1: 1, lat_V2: 1, lon_V2: 1
            },
            VALIDE: {
                type: 'ouvrage_art', name: 'Tunnel C',
                lat_V1: 1, lon_V1: 1, lat_V2: 1.001, lon_V2: 1
            }
        }, 5);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
    });

    it('projette les longueurs disponibles dans les données réelles', async () => {
        const fetchFile = async path => {
            const text = readFileSync(path, 'utf8');
            return {
                ok: true,
                status: 200,
                json: async () => JSON.parse(text),
                text: async () => text
            };
        };
        const data = JSON.parse(readFileSync('data/masterRoutes.normalized.json', 'utf8'));
        const corridors = await loadRailCorridors('data/datasets/rail-pk.json', fetchFile);
        const suggestions = applyStructureEndpointSuggestions(data.points, corridors);
        expect(suggestions.size).toBe(12);
        expect(data.points.TUNNEL_DE_TARTAIGUILLE.longueur).toBe(2340);
        expect(suggestions.get('TRANCHEE_COUVERTE_DE_VILLECRESNE').path.length).toBeGreaterThan(20);
        expect(validateStructureEndpoints(data.points, 5).errors).toHaveLength(8);
    });
});
