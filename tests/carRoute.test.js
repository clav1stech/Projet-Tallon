// tests/carRoute.test.js
// Route voiture hybride (js/car-route.js) : aplatissement corridor PK +
// waypoints manuels en une route unique.

import { describe, it, expect } from 'vitest';
import {
    buildCarRoute,
    compareRouteProjections,
    estimateDeclaredTunnelProgress,
    findSector,
    listDeclaredTunnels,
    locateRouteProgress,
    progressBetweenWaypoints,
    projectRouteLength,
    resolveWaypointTarget,
    DEFAULT_LEG_SPEED_KMH
} from '../js/car-route.js';

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

    it('durationEffective dérivée de avgSpeedKmh (compat fakeGeoSim)', () => {
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
        expect(route.waypoints[0]).toMatchObject({
            type: 'viaduc', lengthM: 500, legIndex: 0,
            sourceKey: 'corridor:mini-a40:Viaduc Test:forward'
        });
        expect(route.waypoints[0].lat).toBeCloseTo(46.20);
        expect(route.waypoints[0].lon).toBeCloseTo(5.03);
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

describe('projectRouteLength', () => {
    it("projette la longueur d'un ouvrage à partir de son repère dans le sens du trajet", () => {
        const route = buildCarRoute(ROUTE_CFG, DATASETS);
        const entryKm = route.cumKm[1];
        const projected = projectRouteLength(route, entryKm, 1000, 0);

        expect(projected[0].routeKm).toBeCloseTo(entryKm, 6);
        expect(projected.at(-1).routeKm).toBeCloseTo(entryKm + 1, 6);
        expect(projected.at(-1).routeKm - projected[0].routeKm).toBeCloseTo(1, 6);
    });

    it('limite la fin de la projection à la borne du leg et rejette une longueur invalide', () => {
        const route = buildCarRoute(ROUTE_CFG, DATASETS);
        const legEndKm = route.legs[0].endKm;
        const projected = projectRouteLength(route, legEndKm - 0.2, 1000, 0);

        expect(projected[0].routeKm).toBeCloseTo(legEndKm - 0.2, 6);
        expect(projected.at(-1).routeKm).toBeCloseTo(legEndKm, 6);
        expect(projectRouteLength(route, 1, 0, 0)).toEqual([]);
    });

    it("projette vers l'ouest dans l'ordre du trajet retour", () => {
        const reverseRoute = buildCarRoute({
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', reverse: true }]
        }, DATASETS);
        const entryKm = reverseRoute.cumKm[1];
        const projected = projectRouteLength(reverseRoute, entryKm, 1000, 0);

        expect(projected[0].routeKm).toBeCloseTo(entryKm, 6);
        expect(projected.at(-1).routeKm).toBeCloseTo(entryKm + 1, 6);
        expect(projected.at(-1).lon).toBeLessThan(projected[0].lon);
    });

    it('contrôle la superposition dans les deux sens avec une tolérance métrique', () => {
        const forward = [
            { lat: 46.2, lon: 5.00 },
            { lat: 46.2, lon: 5.06 }
        ];
        const reverse = [...forward].reverse();
        const slightlyOffset = reverse.map(point => ({ ...point, lat: point.lat + 0.0001 }));
        const clearlyOffset = reverse.map(point => ({ ...point, lat: point.lat + 0.001 }));

        expect(compareRouteProjections(forward, reverse, 20)).toMatchObject({
            comparable: true,
            withinTolerance: true,
            deviationM: 0
        });
        expect(compareRouteProjections(forward, slightlyOffset, 20).withinTolerance).toBe(true);
        expect(compareRouteProjections(forward, clearlyOffset, 20).withinTolerance).toBe(false);
    });
});

describe('listDeclaredTunnels', () => {
    const route = {
        waypoints: [
            { name: 'Sortie 8', type: 'sortie', routeKm: 10 },
            { name: 'Tunnel de Chamoise', type: 'tunnel', routeKm: 20, lengthM: 3300 },
            { name: 'Viaduc de Nantua', type: 'viaduc', routeKm: 24, lengthM: 1003 },
            { name: 'Tunnel sans longueur', type: 'tunnel', routeKm: 30 }
        ]
    };

    it('borne chaque tunnel de son entrée à sa sortie', () => {
        const tunnels = listDeclaredTunnels(route);
        expect(tunnels).toHaveLength(1);
        expect(tunnels[0]).toMatchObject({ name: 'Tunnel de Chamoise', startKm: 20, lengthM: 3300 });
        expect(tunnels[0].endKm).toBeCloseTo(23.3, 6);
    });

    it('ignore les ouvrages à ciel ouvert et les tunnels sans longueur', () => {
        const noms = listDeclaredTunnels(route).map(t => t.name);
        expect(noms).not.toContain('Viaduc de Nantua');
        expect(noms).not.toContain('Tunnel sans longueur');
    });

    it('itinéraire vide ou absent : liste vide', () => {
        expect(listDeclaredTunnels(null)).toEqual([]);
        expect(listDeclaredTunnels({})).toEqual([]);
    });
});

describe('progression sans GPS dans un tunnel déclaré', () => {
    const tunnelRoute = {
        points: [
            { lat: 46.2, lon: 5.00 },
            { lat: 46.2, lon: 5.02 },
            { lat: 46.2, lon: 5.04 },
            { lat: 46.2, lon: 5.06 }
        ],
        cumKm: [0, 1, 2, 3],
        totalKm: 3,
        waypoints: [{ name: 'Tunnel Test', type: 'tunnel', routeKm: 1, lengthM: 1000 }]
    };

    it('localise une progression cumulée sur son segment', () => {
        expect(locateRouteProgress(tunnelRoute, 1.25)).toMatchObject({
            routeKm: 1.25,
            segmentIndex: 1,
            distanceFromSegmentStart: 0.25,
            distanceToNextPointKm: 0.75
        });
    });

    it("continue à la vitesse d'entrée dans le tunnel puis pendant 10 s de grâce", () => {
        const options = { entryToleranceM: 100, exitGraceMs: 10_000 };
        const inside = estimateDeclaredTunnelProgress(tunnelRoute, 0.95, 72, 5_000, options);
        const grace = estimateDeclaredTunnelProgress(tunnelRoute, 0.95, 72, 55_000, options);

        expect(inside).toMatchObject({ phase: 'tunnel', doneKm: 1.05, inExitGrace: false });
        expect(grace).toMatchObject({ phase: 'tunnel', doneKm: 2.05, inExitGrace: true });
    });

    it('fige la progression seulement après les 10 s de raccrochage', () => {
        const options = { entryToleranceM: 100, exitGraceMs: 10_000 };
        const lost = estimateDeclaredTunnelProgress(tunnelRoute, 0.95, 72, 70_000, options);

        expect(lost).toMatchObject({ phase: 'lost', doneKm: 2.2, inExitGrace: false });
        expect(estimateDeclaredTunnelProgress(tunnelRoute, 0.5, 72, 5_000, options)).toBeNull();
    });
});

describe('buildCarRoute — reverse (trajet retour)', () => {
    it('leg corridor reverse : points à rebours, pk décroissants, cumKm croissant', () => {
        const cfg = {
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', reverse: true }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.points.map(p => p.pk)).toEqual([15, 10, 5, 0]);
        for (let i = 1; i < route.cumKm.length; i++) {
            expect(route.cumKm[i]).toBeGreaterThan(route.cumKm[i - 1]);
        }
    });

    it('waypoints d\'un leg reverse : PK commun par défaut, routeKm mesuré depuis le nouveau départ', () => {
        const cfg = {
            legs: [{
                type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', reverse: true,
                waypoints: [
                    { pk: 12.5, name: 'Sortie 1 – Test', type: 'sortie' },
                    { pk: 2.5, name: 'Viaduc Test', type: 'viaduc' }
                ]
            }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        // Ordre de parcours inversé : la sortie (pk 12.5) passe avant le viaduc (pk 2.5)
        expect(route.waypoints.map(w => w.name)).toEqual(['Sortie 1 – Test', 'Viaduc Test']);
        // pk 12.5 = milieu du 1er segment parcouru (pk 15 → 10)
        expect(route.waypoints[0].routeKm).toBeCloseTo(route.cumKm[1] / 2, 5);
        // pk 2.5 = milieu du dernier segment (pk 5 → 0)
        expect(route.waypoints[1].routeKm).toBeCloseTo((route.cumKm[2] + route.cumKm[3]) / 2, 5);
    });

    it('utilise reversePk et les coordonnées retour quand ils sont fournis', () => {
        const cfg = {
            legs: [{
                type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', reverse: true,
                waypoints: [{
                    pk: 2.5, reversePk: 12.5,
                    lat: 46.2, lon: 5.03,
                    reverseLat: 46.21, reverseLon: 5.15,
                    name: 'Échangeur directionnel', type: 'echangeur'
                }]
            }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.waypoints[0]).toMatchObject({
            pk: 12.5,
            lat: 46.21,
            lon: 5.15,
            sourceKey: 'corridor:mini-a40:Échangeur directionnel:reverse'
        });
    });

    it('reverse + pkRange : filtre appliqué avant inversion', () => {
        const cfg = {
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40', pkRange: [5, 15], reverse: true }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.points.map(p => p.pk)).toEqual([15, 10, 5]);
    });
});

describe('buildCarRoute — origin/destination synthétiques', () => {
    it('origin ajouté en tête quand aucun waypoint n\'occupe le départ', () => {
        const cfg = {
            origin: 'Départ Test',
            legs: [{
                type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40',
                waypoints: [{ pk: 12.5, name: 'Sortie', type: 'sortie' }]
            }]
        };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.waypoints[0]).toMatchObject({ name: 'Départ Test', type: 'depart', routeKm: 0 });
    });

    it('destination ajoutée en queue ; pas de doublon si une étape existe déjà à l\'extrémité', () => {
        const cfg = { ...ROUTE_CFG, origin: 'Départ Test', destination: 'Arrivée Test' };
        const route = buildCarRoute(cfg, DATASETS);
        expect(route.waypoints[0].type).toBe('depart');
        // Le leg 'points' fournit déjà l'étape "Sommet" à totalKm : pas d'arrivée synthétique
        expect(route.waypoints[route.waypoints.length - 1].name).toBe('Sommet');

        const cfgDest = {
            destination: 'Arrivée Test',
            legs: [{ type: 'pk-corridor', datasetId: 'mini-a40', label: 'A40' }]
        };
        const routeDest = buildCarRoute(cfgDest, DATASETS);
        expect(routeDest.waypoints[routeDest.waypoints.length - 1])
            .toMatchObject({ name: 'Arrivée Test', type: 'arrivee', routeKm: routeDest.totalKm });
    });
});

describe('resolveWaypointTarget', () => {
    const waypoints = [
        { name: 'Sortie 8', type: 'sortie', routeKm: 10 },
        { name: 'Tunnel de Chamoise', type: 'tunnel', routeKm: 20, lengthM: 3300 },
        { name: 'Viaduc de Nantua', type: 'viaduc', routeKm: 23.3, lengthM: 1003 },
        { name: 'Sortie 9', type: 'sortie', routeKm: 30 }
    ];

    it('cible le prochain point de passage et sa distance', () => {
        const target = resolveWaypointTarget(waypoints, 5);
        expect(target.nextWaypoint.name).toBe('Sortie 8');
        expect(target.nextIndex).toBe(0);
        expect(target.nextDistanceKm).toBeCloseTo(5, 6);
        expect(target.onStructure).toBe(false);
    });

    it("garde l'ouvrage comme cible entre son entrée et sa sortie", () => {
        const target = resolveWaypointTarget(waypoints, 21.65);
        expect(target.nextWaypoint.name).toBe('Tunnel de Chamoise');
        expect(target.onStructure).toBe(true);
        expect(target.nextDistanceKm).toBeCloseTo(1.65, 6);
        expect(target.structureProgress).toBeCloseTo(0.5, 6);
    });

    it('passe au point suivant une fois la sortie franchie', () => {
        const target = resolveWaypointTarget(waypoints, 23.31);
        expect(target.nextWaypoint.name).toBe('Viaduc de Nantua');
        expect(target.onStructure).toBe(true);
        expect(resolveWaypointTarget(waypoints, 24.4).nextWaypoint.name).toBe('Sortie 9');
    });

    it('un point sans longueur ne retient jamais la cible', () => {
        const target = resolveWaypointTarget(waypoints, 10.0001);
        expect(target.nextWaypoint.name).toBe('Tunnel de Chamoise');
        expect(target.onStructure).toBe(false);
    });

    it('après le dernier point ou sur une entrée invalide : aucune cible', () => {
        expect(resolveWaypointTarget(waypoints, 40).nextWaypoint).toBeNull();
        expect(resolveWaypointTarget(null, 10).nextWaypoint).toBeNull();
        expect(resolveWaypointTarget(waypoints, NaN).nextWaypoint).toBeNull();
    });
});

describe('progressBetweenWaypoints', () => {
    const wps = [
        { name: 'Sortie 8', routeKm: 10 },
        { name: 'Tunnel de Chamoise', routeKm: 20, lengthM: 3300 },  // fin à 23,3
        { name: 'Viaduc de Nantua', routeKm: 23.32, lengthM: 1003 },
        { name: 'Sortie 9', routeKm: 30 }
    ];

    it('mesure depuis la FIN de l\'ouvrage précédent', () => {
        // Au sortir du tunnel (23,3 km), on ne doit pas déjà être avancé vers
        // le point suivant : la tête de lecture repart de son nœud.
        expect(progressBetweenWaypoints(wps, 1, 2, 23.3)).toBeCloseTo(0, 6);
        expect(progressBetweenWaypoints(wps, 2, 3, 24.323)).toBeCloseTo(0, 6);
    });

    it('progresse ensuite jusqu\'au début du point suivant', () => {
        expect(progressBetweenWaypoints(wps, 2, 3, 27.1615)).toBeCloseTo(0.5, 3);
        expect(progressBetweenWaypoints(wps, 2, 3, 30)).toBe(1);
    });

    it('sature pendant la traversée de l\'ouvrage visé', () => {
        // doneKm au-delà du repère d'entrée de la cible : on est dessus.
        expect(progressBetweenWaypoints(wps, 0, 1, 21.5)).toBe(1);
    });

    it('ouvrages jointifs : aucun intervalle à parcourir', () => {
        const colles = [{ routeKm: 20, lengthM: 3300 }, { routeKm: 23.3 }];
        expect(progressBetweenWaypoints(colles, 0, 1, 23.3)).toBe(1);
        expect(progressBetweenWaypoints(colles, 0, 1, 22)).toBe(0);
    });

    it('index ou distance invalides : aucun avancement', () => {
        expect(progressBetweenWaypoints(wps, -1, 0, 10)).toBe(0);
        expect(progressBetweenWaypoints(wps, 0, 99, 10)).toBe(0);
        expect(progressBetweenWaypoints(null, 0, 1, 10)).toBe(0);
        expect(progressBetweenWaypoints(wps, 0, 1, NaN)).toBe(0);
    });
});

describe('findSector', () => {
    const cfg = {
        legs: [
            {
                type: 'pk-corridor', label: 'A40',
                sector: 'Repli',
                sectors: [
                    { name: 'Ouest', pkFrom: 0, pkTo: 7 },
                    { name: 'Est', pkFrom: 7, pkTo: 15 }
                ]
            },
            { type: 'points', label: 'Montée', sector: 'Sommital' }
        ]
    };

    it('plage pk du leg corridor (indépendant du sens de parcours)', () => {
        expect(findSector(cfg, 0, 3)).toBe('Ouest');
        expect(findSector(cfg, 0, 12)).toBe('Est');
    });

    it('repli sur le secteur unique du leg : pk hors plage ou leg sans plages', () => {
        expect(findSector(cfg, 0, 20)).toBe('Repli');
        expect(findSector(cfg, 1, null)).toBe('Sommital');
    });

    it('leg inconnu ou sans secteur → null', () => {
        expect(findSector(cfg, 5, 3)).toBeNull();
        expect(findSector({ legs: [{ type: 'points' }] }, 0, null)).toBeNull();
    });
});
