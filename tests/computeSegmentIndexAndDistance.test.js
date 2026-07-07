// tests/computeSegmentIndexAndDistance.test.js
import { describe, it, expect } from 'vitest';
import { computeSegmentIndexAndDistance, projectPositionOnRouteSegment, findNearestSegmentIndex } from '../js/functions.js';
import { haversineDistance } from '../js/geo.js';
import { southboundRoute, northboundRoute, positionOnSegment, metersToLatDeg, metersToLonDeg, makeEffectiveRoute } from './fixtures.js';

describe('computeSegmentIndexAndDistance — cas nominal', () => {
    it('trouve le bon segment quand la position est pile sur la ligne', () => {
        const route = southboundRoute();
        const pos = positionOnSegment(route, 3, 0.5);
        const res = computeSegmentIndexAndDistance(route, pos.lat, pos.lon, 2, 15, 'SUD');
        expect(res.segmentIndex).toBe(3);
        expect(res.distanceFromSegmentStart).toBeGreaterThan(0);
        expect(res.distanceToNextPointKm).toBeGreaterThan(0);
        // Milieu de segment : les deux moitiés sont approximativement égales
        expect(res.distanceFromSegmentStart).toBeCloseTo(res.distanceToNextPointKm, 1);
    });

    it('tolère un écart latéral réaliste (train sur voie parallèle, ~80 m)', () => {
        const route = southboundRoute();
        const pos = positionOnSegment(route, 2, 0.4, metersToLatDeg(80));
        const res = computeSegmentIndexAndDistance(route, pos.lat, pos.lon, 2, 20, 'SUD');
        expect(res.segmentIndex).toBe(2);
    });

    it('retourne null pour une route vide ou trop courte', () => {
        expect(computeSegmentIndexAndDistance([], 48.8, 2.4).segmentIndex).toBeNull();
        expect(computeSegmentIndexAndDistance(null, 48.8, 2.4).segmentIndex).toBeNull();
        expect(computeSegmentIndexAndDistance([{ lat: 48.8, lon: 2.4 }], 48.8, 2.4).segmentIndex).toBeNull();
    });
});

describe('cas limite : perte de GPS en tunnel puis réapparition', () => {
    it('raccroche plus loin sur la route quand le fix réapparaît hors de la fenêtre locale', () => {
        const route = southboundRoute();
        // Dernier segment connu : 1. Le GPS revient au segment 6 (fenêtre = [max(0,-1)..4]).
        const pos = positionOnSegment(route, 6, 0.3);
        const res = computeSegmentIndexAndDistance(route, pos.lat, pos.lon, 1, 30, 'SUD');
        expect(res.segmentIndex).toBe(6);
    });

    it('snap sur le point le plus proche NE simule PLUS une arrivée (régression distanceToNextPointKm=0)', () => {
        const route = southboundRoute();
        // Position à ~780 m PERPENDICULAIREMENT à la voie au niveau de P3
        // (la voie est orientée SSE : un décalage plein est ≈ perpendiculaire) :
        // hors tolérance segment, mais dans la tolérance de match par point (900 m).
        const lat = route[3].lat;
        const lon = route[3].lon + metersToLonDeg(780, route[3].lat);
        const res = computeSegmentIndexAndDistance(route, lat, lon, 2, 50, 'SUD');
        expect(res.segmentIndex).toBe(3);
        // Avant correction : distanceToNextPointKm === 0 → fausse arrivée si
        // le segment est l'avant-dernier. Désormais on projette réellement.
        expect(res.distanceToNextPointKm).toBeGreaterThan(1);
    });

    it('le snap près du terminus donne bien une petite distance restante (vraie arrivée)', () => {
        const route = southboundRoute();
        const last = route[route.length - 1];
        const lat = last.lat + metersToLatDeg(650);
        const lon = last.lon;
        const res = computeSegmentIndexAndDistance(route, lat, lon, route.length - 2, 50, 'SUD');
        expect(res.segmentIndex).toBe(route.length - 2);
        expect(res.distanceToNextPointKm).toBeLessThan(1);
    });
});

describe('cas limite : rebond de précision (fix très imprécis)', () => {
    it('utilise le fallback par latitude quand la position est loin de la ligne', () => {
        const route = southboundRoute();
        // 5 km à l'est de la ligne, à la latitude du segment 4
        const mid = positionOnSegment(route, 4, 0.5);
        const res = computeSegmentIndexAndDistance(route, mid.lat, mid.lon + 0.07, 4, 100, 'SUD');
        expect(res.segmentIndex).toBe(4);
    });

    it('le fallback par latitude ne recule jamais derrière lastSegmentIndex', () => {
        const route = southboundRoute();
        // Position lointaine à une latitude correspondant au segment 2, mais
        // le train a déjà validé le segment 5 → on ne recule pas.
        const back = positionOnSegment(route, 2, 0.5);
        const res = computeSegmentIndexAndDistance(route, back.lat, back.lon + 0.07, 5, 100, 'SUD');
        expect(res.segmentIndex).toBeGreaterThanOrEqual(5);
    });

    it('fallback par latitude fonctionne aussi en sens NORD', () => {
        const route = northboundRoute();
        const mid = positionOnSegment(route, 3, 0.5);
        const res = computeSegmentIndexAndDistance(route, mid.lat, mid.lon + 0.07, 3, 100, 'NORD');
        expect(res.segmentIndex).toBe(3);
    });
});

describe('cas limite : bifurcation / segments adjacents', () => {
    it('avec lastSegmentIndex, préfère le segment de continuité dans la fenêtre locale', () => {
        // Deux branches quasi parallèles après un point de bifurcation :
        // la fenêtre de recherche centrée sur lastSegmentIndex évite de sauter.
        const route = southboundRoute();
        const pos = positionOnSegment(route, 5, 0.1, metersToLatDeg(40));
        const res = computeSegmentIndexAndDistance(route, pos.lat, pos.lon, 5, 25, 'SUD');
        expect(res.segmentIndex).toBe(5);
    });

    it('la projection reste correcte sur segment orienté est-ouest (correction cos(lat))', () => {
        // Segment plein est à 48.7°N : sans correction cos(lat), le ratio de
        // projection est biaisé pour une position décalée en diagonale.
        const route = makeEffectiveRoute([
            { id: 'A', lat: 48.7, lon: 2.0, durationToNext: 120 },
            { id: 'B', lat: 48.7, lon: 2.2, durationToNext: 120 },
            { id: 'C', lat: 48.7, lon: 2.4, durationToNext: 0 }
        ]);
        // Position au quart du segment 0, avec léger bruit latitudinal
        const lon = 2.0 + 0.05;
        const lat = 48.7 + metersToLatDeg(50);
        const res = computeSegmentIndexAndDistance(route, lat, lon, 0, 15, null);
        expect(res.segmentIndex).toBe(0);
        const segLen = route[0].segmentLengthToNext;
        expect(res.distanceFromSegmentStart / segLen).toBeCloseTo(0.25, 1);
    });
});

describe('projectPositionOnRouteSegment (garde-fou unidirectionnel)', () => {
    it('reprojette les distances sur le segment forcé', () => {
        const route = southboundRoute();
        const pos = positionOnSegment(route, 4, 0.2);
        const proj = projectPositionOnRouteSegment(route, 4, pos.lat, pos.lon);
        const segLen = route[4].segmentLengthToNext;
        expect(proj.distanceFromSegmentStart).toBeCloseTo(segLen * 0.2, 1);
        expect(proj.distanceToNextPointKm).toBeCloseTo(segLen * 0.8, 1);
    });

    it('clamp la projection aux bornes du segment (position déjà derrière)', () => {
        const route = southboundRoute();
        const behind = positionOnSegment(route, 2, 0.5);
        const proj = projectPositionOnRouteSegment(route, 4, behind.lat, behind.lon);
        expect(proj.distanceFromSegmentStart).toBe(0);
        expect(proj.distanceToNextPointKm).toBeCloseTo(route[4].segmentLengthToNext, 5);
    });

    it('retourne des zéros pour un index invalide', () => {
        const route = southboundRoute();
        expect(projectPositionOnRouteSegment(route, -1, 48.7, 2.4)).toEqual({ distanceFromSegmentStart: 0, distanceToNextPointKm: 0 });
        expect(projectPositionOnRouteSegment(route, route.length - 1, 48.7, 2.4)).toEqual({ distanceFromSegmentStart: 0, distanceToNextPointKm: 0 });
    });
});

describe('findNearestSegmentIndex (seed du premier fix)', () => {
    it('trouve le segment le plus proche pour un embarquement en milieu de route', () => {
        const route = southboundRoute();
        const pos = positionOnSegment(route, 6, 0.7, metersToLatDeg(60));
        expect(findNearestSegmentIndex(route, pos.lat, pos.lon)).toBe(6);
    });

    it('retourne 0 pour une route invalide', () => {
        expect(findNearestSegmentIndex([], 48.8, 2.4)).toBe(0);
        expect(findNearestSegmentIndex(null, 48.8, 2.4)).toBe(0);
    });
});

describe('garde-fou du sens de circulation (fenêtre de recherche)', () => {
    it('un rebond GPS vers une latitude très en arrière ne fait pas reculer le tracking', () => {
        const route = southboundRoute();
        // lastSegmentIndex = 6, rebond vers la latitude du segment 0 (hors
        // fenêtre locale ET loin de la ligne) : le fallback par latitude clampe
        // le résultat pour ne jamais revenir derrière lastSegmentIndex.
        const pos = positionOnSegment(route, 0, 0.5);
        const res = computeSegmentIndexAndDistance(route, pos.lat, pos.lon + 0.07, 6, 100, 'SUD');
        expect(res.segmentIndex).toBeGreaterThanOrEqual(6);
        // Et le garde-fou de showPosition reprojette proprement sur le segment forcé
        const clamped = projectPositionOnRouteSegment(route, 6, pos.lat, pos.lon);
        expect(clamped.distanceFromSegmentStart).toBe(0);
        expect(clamped.distanceToNextPointKm).toBeCloseTo(route[6].segmentLengthToNext, 5);
    });
});

describe('cohérence haversine', () => {
    it('distanceFromSegmentStart + distanceToNextPointKm = longueur du segment', () => {
        const route = southboundRoute();
        for (const t of [0.1, 0.5, 0.9]) {
            const pos = positionOnSegment(route, 3, t);
            const res = computeSegmentIndexAndDistance(route, pos.lat, pos.lon, 3, 15, 'SUD');
            const segLen = haversineDistance(route[3].lat, route[3].lon, route[4].lat, route[4].lon);
            expect(res.distanceFromSegmentStart + res.distanceToNextPointKm).toBeCloseTo(segLen, 3);
        }
    });
});
