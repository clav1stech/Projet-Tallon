// tests/carRoute.test.js
// Route voiture hybride (js/car-route.js) : aplatissement corridor PK +
// waypoints manuels en une route unique, et calcul d'ETA.

import { describe, it, expect } from 'vitest';
import { buildCarRoute, computeEtaSeconds, DEFAULT_LEG_SPEED_KMH } from '../js/car-route.js';

// Mini corridor "autoroute" ouest-est + montée "points" vers le sud,
// avec jonction confondue (dernier point corridor = premier waypoint).
const DATASETS = {
    'mini-a40': {
        points: [
            { pk: 0, lat: 46.20, lon: 5.00, line: 'A40' },
            { pk: 5, lat: 46.20, lon: 5.06, line: 'A40' },
            { pk: 10, lat: 46.20, lon: 5.12, line: 'A40' },
            { pk: 15, lat: 46.20, lon: 5.18, line: 'A40' }
        ]
    }
};

const ROUTE_CFG = {
    label: 'Test hybride',
    legs: [
        { type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', avgSpeedKmh: 120 },
        {
            type: 'points', label: 'Montée', avgSpeedKmh: 40,
            points: [
                { id: 'J', name: 'Jonction', lat: 46.20, lon: 5.18 },   // = dernier point corridor
                { id: 'M', name: 'Mi-pente', lat: 46.15, lon: 5.19 },
                { id: 'TOP', name: 'Sommet', lat: 46.10, lon: 5.20 }
            ]
        }
    ]
};

describe('buildCarRoute — pkRange', () => {
    it('ne garde que la portion [min, max] du corridor (jonction en cours de route, sortie avant la fin)', () => {
        const cfg = {
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', pkRange: [5, 10] }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.points.map(p => p.pk)).toEqual([5, 10]);
    });

    it('borne non finie = non contraignante (null)', () => {
        const cfg = {
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', pkRange: [null, 10] }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.points.map(p => p.pk)).toEqual([0, 5, 10]);
    });

    it('sans pkRange : corridor complet (comportement inchangé)', () => {
        const cfg = {
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40' }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.points).toHaveLength(4);
    });

    it('pkRange vidant le corridor → erreur (moins de 2 points)', () => {
        const cfg = {
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', pkRange: [100, 200] }]
        };
        expect(() => buildCarRoute(cfg, DATASETS)).toThrowError(/moins de 2 points/);
    });
});

describe('buildCarRoute', () => {
    const route = buildCarRoute(ROUTE_CFG, DATASETS);

    it('concatène les legs en une route unique, jonction dédupliquée', () => {
        // 4 points corridor + 3 waypoints - 1 doublon de jonction = 6
        expect(route.points).toHaveLength(6);
        expect(route.points[3].pk).toBe(15);          // dernier point corridor
        expect(route.points[4].name).toBe('Mi-pente'); // la jonction dupliquée a sauté
    });

    it('cumKm strictement croissant et totalKm cohérent', () => {
        for (let i = 1; i < route.cumKm.length; i++) {
            expect(route.cumKm[i]).toBeGreaterThan(route.cumKm[i - 1]);
        }
        expect(route.totalKm).toBeCloseTo(route.cumKm[route.cumKm.length - 1]);
    });

    it('le PK n\'existe que sur les points du leg corridor', () => {
        expect(route.points.slice(0, 4).every(p => Number.isFinite(p.pk))).toBe(true);
        expect(route.points.slice(4).every(p => p.pk === undefined)).toBe(true);
    });

    it('chaque point porte legIndex et legLabel pour l\'affichage', () => {
        expect(route.points[0]).toMatchObject({ legIndex: 0, legLabel: 'A40' });
        expect(route.points[5]).toMatchObject({ legIndex: 1, legLabel: 'Montée' });
    });

    it('durationEffective dérivée de avgSpeedKmh (compat fakeGeoSim + ETA théorique)', () => {
        const segKm = route.cumKm[1] - route.cumKm[0];
        expect(route.points[0].durationEffective).toBeCloseTo((segKm / 120) * 3600, 1);
        expect(route.points[route.points.length - 1].durationEffective).toBe(0);
    });

    it('métadonnées de legs : bornes d\'index et de km', () => {
        expect(route.legs).toHaveLength(2);
        expect(route.legs[0]).toMatchObject({ label: 'A40', startIdx: 0, endIdx: 3 });
        // La jonction dédupliquée appartient au leg 0 (points[3]) : le leg 1
        // commence donc à l'index 4.
        expect(route.legs[1].startIdx).toBe(4);
        expect(route.legs[1].endIdx).toBe(5);
    });

    it('dataset manquant → erreur explicite', () => {
        expect(() => buildCarRoute(ROUTE_CFG, {})).toThrowError(/dataset "mini-a40" manquant/);
    });

    it('type de leg inconnu → erreur explicite', () => {
        const cfg = { legs: [{ type: 'ferry', label: '?' }] };
        expect(() => buildCarRoute(cfg, {})).toThrowError(/type de leg inconnu/i);
    });

    it('config invalide → erreur', () => {
        expect(() => buildCarRoute(null, {})).toThrow();
        expect(() => buildCarRoute({ legs: [] }, {})).toThrow();
    });

    it('vitesse par défaut selon le type de leg si avgSpeedKmh absent', () => {
        const cfg = {
            legs: [{
                type: 'points', label: 'X',
                points: [
                    { id: 'A', name: 'A', lat: 46.0, lon: 5.0 },
                    { id: 'B', name: 'B', lat: 46.1, lon: 5.0 }
                ]
            }]
        };
        const r = buildCarRoute(cfg, {});
        const segKm = r.cumKm[1];
        expect(r.points[0].durationEffective).toBeCloseTo((segKm / DEFAULT_LEG_SPEED_KMH['points']) * 3600, 1);
    });
});

describe('buildCarRoute — waypoints', () => {
    it('waypoints corridor interpolés en km-route + points nommés en étapes, triés', () => {
        const cfg = {
            legs: [
                {
                    type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40',
                    waypoints: [
                        { pk: 12.5, km: 13, name: 'Sortie 1 – Test', type: 'sortie' },
                        { pk: 2.5, km: 3, name: 'Viaduc Test', type: 'viaduc', lengthM: 500 }
                    ]
                },
                {
                    type: 'points', label: 'Montée',
                    points: [
                        { id: 'J', name: 'Jonction', lat: 46.20, lon: 5.18 },
                        { id: 'TOP', name: 'Sommet', lat: 46.10, lon: 5.20 }
                    ]
                }
            ]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.waypoints.map(w => w.name)).toEqual(['Viaduc Test', 'Sortie 1 – Test', 'Sommet']);
        // pk 2.5 = milieu du 1er segment (pk 0 → 5) : routeKm = cumKm[1] / 2
        expect(route.waypoints[0].routeKm).toBeCloseTo(route.cumKm[1] / 2, 5);
        expect(route.waypoints[0]).toMatchObject({ type: 'viaduc', lengthM: 500, legIndex: 0 });
        // pk 12.5 = milieu du segment pk 10 → 15
        expect(route.waypoints[1].routeKm).toBeCloseTo((route.cumKm[2] + route.cumKm[3]) / 2, 5);
        // La jonction dédupliquée n'apparaît pas ; le point nommé restant devient une étape.
        expect(route.waypoints[2]).toMatchObject({ type: 'etape', routeKm: route.totalKm });
    });

    it('waypoint hors du pkRange effectif du leg : ignoré', () => {
        const cfg = {
            legs: [{
                type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', pkRange: [5, 10],
                waypoints: [
                    { pk: 2, name: 'Avant', type: 'sortie' },
                    { pk: 7.5, name: 'Dedans', type: 'sortie' },
                    { pk: 14, name: 'Après', type: 'sortie' }
                ]
            }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.waypoints.map(w => w.name)).toEqual(['Dedans']);
    });

    it('sans waypoints déclarés : liste vide (pas d\'erreur)', () => {
        const route = buildCarRoute(ROUTE_CFG, DATASETS);
        // ROUTE_CFG n'a pas de waypoints corridor mais des points nommés (étapes)
        expect(route.waypoints.every(w => w.type === 'etape')).toBe(true);
        expect(route.waypoints.map(w => w.name)).toEqual(['Mi-pente', 'Sommet']);
    });
});

describe('computeEtaSeconds', () => {
    const samples = (speeds, reliable = true) => speeds.map(v => ({ v, reliable }));

    it('ETA = distance restante ÷ vitesse moyenne fiable', () => {
        expect(computeEtaSeconds(60, samples([120, 120, 120]))).toBeCloseTo(1800);
    });

    it('plancher de vitesse (20 km/h) : pas d\'ETA infinie à l\'arrêt', () => {
        expect(computeEtaSeconds(10, samples([0, 0, 5]))).toBeCloseTo((10 / 20) * 3600);
    });

    it('ignore les échantillons non fiables', () => {
        const mixed = [...samples([100], true), ...samples([0, 0, 0], false)];
        expect(computeEtaSeconds(100, mixed)).toBeCloseTo(3600);
    });

    it('aucun échantillon fiable → null (ETA inconnue, pas de mensonge)', () => {
        expect(computeEtaSeconds(50, samples([100, 100], false))).toBeNull();
        expect(computeEtaSeconds(50, [])).toBeNull();
    });

    it('ne considère que les maxSamples derniers échantillons (fenêtre glissante)', () => {
        const old = samples(Array(200).fill(20));
        const recent = samples(Array(120).fill(120));
        expect(computeEtaSeconds(120, [...old, ...recent], { maxSamples: 120 })).toBeCloseTo(3600);
    });

    it('distance nulle → 0 ; distance invalide → null', () => {
        expect(computeEtaSeconds(0, samples([100]))).toBe(0);
        expect(computeEtaSeconds(NaN, samples([100]))).toBeNull();
        expect(computeEtaSeconds(-5, samples([100]))).toBeNull();
    });
});
