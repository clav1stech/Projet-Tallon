import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCorridor } from '../js/linearref.js';
import { loadRailCorridors } from '../js/train-structure-endpoints.js';
import { buildTrainRoutePolyline } from '../js/train-map-polyline.js';

function route(...ids) {
    return { points: ids.map(id => ({ id })) };
}

describe('polyline cartographique des trajets rail', () => {
    it('suit les points intermédiaires du corridor au lieu de relier les repères en ligne droite', () => {
        const corridor = buildCorridor([
            { pk: 0, lat: 0, lon: 0 },
            { pk: 1, lat: 0, lon: 0.01 },
            { pk: 2, lat: 0.01, lon: 0.01 }
        ]);
        const points = {
            DEPART: { lat: 0, lon: 0, code_ligne: 'L' },
            ARRIVEE: { lat: 0.01, lon: 0.01, code_ligne: 'L' }
        };

        const path = buildTrainRoutePolyline(points, route('DEPART', 'ARRIVEE'), 1, new Map([['L', corridor]]));

        expect(path[0]).toMatchObject({ lat: 0, lon: 0 });
        expect(path.at(-1)).toMatchObject({ lat: 0.01, lon: 0.01 });
        expect(path.some(point => point.lat === 0 && point.lon === 0.01)).toBe(true);
    });

    it('change de corridor à une bifurcation selon la ligne commune au segment suivant', () => {
        const first = buildCorridor([
            { pk: 0, lat: 0, lon: 0 },
            { pk: 1, lat: 0, lon: 0.01 },
            { pk: 2, lat: 0, lon: 0.02 }
        ]);
        const second = buildCorridor([
            { pk: 0, lat: 0, lon: 0.02 },
            { pk: 1, lat: 0.01, lon: 0.02 },
            { pk: 2, lat: 0.02, lon: 0.02 }
        ]);
        const points = {
            DEPART: { lat: 0, lon: 0, code_ligne: 'L1' },
            BIF: { lat: 0, lon: 0.02, code_ligne: 'L1', code_ligne_2: 'L2' },
            ARRIVEE: { lat: 0.02, lon: 0.02, code_ligne: 'L2' }
        };

        const path = buildTrainRoutePolyline(
            points,
            route('DEPART', 'BIF', 'ARRIVEE'),
            1,
            new Map([['L1', first], ['L2', second]])
        );

        expect(path.some(point => point.lat === 0 && point.lon === 0.01)).toBe(true);
        expect(path.some(point => point.lat === 0.01 && point.lon === 0.02)).toBe(true);
        expect(path.at(-1)).toMatchObject({ lat: 0.02, lon: 0.02 });
    });

    it('ne projette pas une portion sans code sur un corridor arbitraire', () => {
        const unrelatedCorridor = buildCorridor([
            { pk: 0, lat: 1, lon: 1 },
            { pk: 1, lat: 1, lon: 1.01 }
        ]);
        const points = {
            DEPART: { lat: 0, lon: 0, code_ligne: '' },
            ARRIVEE: { lat: 0.01, lon: 0.01, code_ligne: '' }
        };

        const path = buildTrainRoutePolyline(
            points,
            route('DEPART', 'ARRIVEE'),
            1,
            new Map([['AUTRE', unrelatedCorridor]])
        );

        expect(path).toEqual([{ lat: 0, lon: 0 }, { lat: 0.01, lon: 0.01 }]);
    });

    it('reconstruit les trajets réels avec la polyline ferroviaire dense', async () => {
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
        const routeParisMacon = data.trajets.find(candidate => candidate.id === 'PAR_MAC_SUD');
        const routeParisLyon = data.trajets.find(candidate => candidate.id === 'PAR_LPD_SUD');

        const maconPath = buildTrainRoutePolyline(data.points, routeParisMacon, 1, corridors);
        const lyonPath = buildTrainRoutePolyline(data.points, routeParisLyon, 1, corridors);

        expect(maconPath.length).toBeGreaterThan(3000);
        expect(maconPath.some(point => Math.abs(point.lat - 48.67599) < 0.00001)).toBe(true);
        expect(lyonPath.some(point => (
            Math.abs(point.lat - 45.81334495510869) < 0.001
            && Math.abs(point.lon - 4.869757728530714) < 0.001
        ))).toBe(true);
        expect(lyonPath.some(point => (
            Math.abs(point.lat - 45.759679) < 0.001
            && Math.abs(point.lon - 4.8599482) < 0.001
        ))).toBe(true);
    });
});
