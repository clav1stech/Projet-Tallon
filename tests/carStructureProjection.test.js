import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAR_ROUTES } from '../js/car-config.js';
import { applyDescriptor, parseCsv } from '../js/csv.js';
import { buildCarRoute, compareRouteProjections, projectRouteLength } from '../js/car-route.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const OVERLAP_TOLERANCE_M = 50;

function loadRouteDatasets(cfg) {
    const datasets = {};
    for (const descriptorUrl of cfg.datasets || []) {
        const descriptor = JSON.parse(readFileSync(resolve(PROJECT_ROOT, descriptorUrl), 'utf8'));
        const csv = readFileSync(resolve(PROJECT_ROOT, descriptor.file), 'utf8');
        datasets[descriptor.id] = {
            descriptor,
            points: applyDescriptor(parseCsv(csv, descriptor.csv || {}), descriptor)
        };
    }
    return datasets;
}

function structureProjections(route) {
    return new Map(route.waypoints
        .filter(wp => wp.sourceKey && Number.isFinite(wp.lengthM))
        .map(wp => {
            const projected = projectRouteLength(route, wp.routeKm, wp.lengthM, wp.legIndex);
            if (projected.length >= 2) {
                projected[0] = { ...projected[0], lat: wp.lat, lon: wp.lon };
            }
            return [wp.sourceKey.replace(/:(forward|reverse)$/, ''), projected];
        }));
}

describe('ouvrages réels A40 dans les deux sens', () => {
    it(`superpose les 15 projections à ±${OVERLAP_TOLERANCE_M} m`, () => {
        const forwardCfg = CAR_ROUTES.MACON_COMBLOUX;
        const reverseCfg = CAR_ROUTES.COMBLOUX_MACON;
        const datasets = loadRouteDatasets(forwardCfg);
        const forward = structureProjections(buildCarRoute(forwardCfg, datasets));
        const reverse = structureProjections(buildCarRoute(reverseCfg, datasets));

        expect(forward.size).toBe(15);
        expect(reverse.size).toBe(15);
        expect([...forward.keys()].sort()).toEqual([...reverse.keys()].sort());

        const comparisons = [...forward].map(([name, projection]) => ({
            name,
            ...compareRouteProjections(projection, reverse.get(name), OVERLAP_TOLERANCE_M)
        }));
        expect(comparisons.every(result => result.comparable)).toBe(true);
        expect(comparisons.filter(result => result.withinTolerance)).toHaveLength(15);
        expect(comparisons.filter(result => !result.withinTolerance)).toEqual([]);
    });
});
