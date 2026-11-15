import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { MAIN_ROUTES } from '../js/routes-config.js';
import { CAR_ROUTES } from '../js/car-config.js';

// Cohérence référentielle des données versionnées : ces fichiers sont édités
// à la main ou par export, et une référence orpheline ne casse l'app qu'à
// l'exécution (liste de points vide, trajet introuvable).

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

const master = readJson('data/masterRoutes.normalized.json');
const { servicePatterns } = readJson('data/servicePatterns.json');
const routeById = new Map(master.trajets.map(route => [route.id, route]));

function routePointIds(masterRouteId) {
    return routeById.get(masterRouteId)?.points.map(point => point.id) ?? [];
}

// Écarts connus des données, à corriger sur demande explicite (jamais en
// silence) : « trajet|point » absent du trajet. Le test échoue quand l'écart
// disparaît, pour forcer le retrait de l'entrée.
const KNOWN_ANOMALIES = new Set(['MRS_PAR_NORD|VALENCE_TGV']);

// Les arrêts doivent exister sur le trajet et s'y succéder dans un sens ou
// dans l'autre : les patterns de retour réutilisent le trajet aller à rebours.
function expectOrderedOnRoute(masterRouteId, ids) {
    const onRoute = routePointIds(masterRouteId);
    const missing = ids.filter(id => !onRoute.includes(id));
    const unexpected = missing.filter(id => !KNOWN_ANOMALIES.has(`${masterRouteId}|${id}`));
    expect(unexpected, `absents de ${masterRouteId}`).toEqual([]);
    const positions = ids.filter(id => onRoute.includes(id)).map(id => onRoute.indexOf(id));
    const ascending = [...positions].sort((a, b) => a - b);
    expect(positions, `ordre sur ${masterRouteId}`)
        .toSatisfy(list => list.every((value, i) => value === ascending[i])
            || list.every((value, i) => value === ascending[ascending.length - 1 - i]));
}

describe('masterRoutes : cohérence interne', () => {
    it('ne contient aucun point orphelin ni aucun doublon dans un trajet', () => {
        const used = new Set(master.trajets.flatMap(route => route.points.map(point => point.id)));
        const orphans = Object.keys(master.points).filter(id => !used.has(id));
        expect(orphans, 'points jamais référencés par un trajet').toEqual([]);
        for (const route of master.trajets) {
            const ids = route.points.map(point => point.id);
            expect(new Set(ids).size, `doublon dans ${route.id}`).toBe(ids.length);
        }
    });
});

describe('anomalies connues', () => {
    it('sont toujours d’actualité', () => {
        for (const entry of KNOWN_ANOMALIES) {
            const [routeId, pointId] = entry.split('|');
            expect(routePointIds(routeId).includes(pointId), `${entry} est corrigée : retirer l’entrée`).toBe(false);
        }
    });
});

describe('servicePatterns.json', () => {
    it('a des identifiants uniques', () => {
        const ids = servicePatterns.map(pattern => pattern.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(servicePatterns.map(pattern => [pattern.id, pattern]))(
        '%s référence un trajet et des arrêts existants',
        (_id, pattern) => {
            expect(routeById.has(pattern.masterRouteId), 'masterRouteId').toBe(true);
            expect(pattern.stops[0]).toBe(pattern.startPointId);
            expect(pattern.stops.at(-1)).toBe(pattern.endPointId);
            for (const id of pattern.stops) expect(master.points[id], id).toBeDefined();
            expectOrderedOnRoute(pattern.masterRouteId, pattern.stops);
        }
    );
});

describe('MAIN_ROUTES (sélecteur de trajets)', () => {
    it.each(Object.entries(MAIN_ROUTES))('%s référence un trajet et des arrêts existants', (_key, route) => {
        expect(routeById.has(route.masterRouteId), 'masterRouteId').toBe(true);
        const stops = route.stopOptions.map(option => option.id);
        expectOrderedOnRoute(route.masterRouteId, [route.startPointId, ...stops, route.endPointId]);
    });
});

describe('datasets du mode voiture et PWA', () => {
    const descriptorFiles = readdirSync('data/datasets').filter(name => name.endsWith('.json'));

    it.each(descriptorFiles)('%s : identifiant cohérent et CSV présent', name => {
        const descriptor = readJson(`data/datasets/${name}`);
        expect(descriptor.id).toBe(name.replace(/\.json$/, ''));
        expect(existsSync(descriptor.file), descriptor.file).toBe(true);
    });

    it('CAR_ROUTES ne référence que des descripteurs existants', () => {
        for (const route of Object.values(CAR_ROUTES)) {
            for (const path of route.datasets) expect(existsSync(path), path).toBe(true);
            const known = new Set(route.datasets.map(path => readJson(path).id));
            for (const leg of route.legs.filter(leg => leg.datasetId)) {
                expect(known.has(leg.datasetId), leg.datasetId).toBe(true);
            }
        }
    });
});

describe('rail-pk : vitesse limite de ligne (vmax)', () => {
    const descriptor = readJson('data/datasets/rail-pk.json');
    const [header, ...lines] = readFileSync(descriptor.file, 'utf8').trim().split('\n');
    const columns = header.split(',');

    it('mappe la colonne logique vmax sur une colonne réelle du CSV', () => {
        expect(descriptor.columns.vmax).toBe('vitesse');
        expect(columns).toContain(descriptor.columns.vmax);
    });

    it('ne contient, sur la ligne du corridor, que des limites plausibles ou NULL', () => {
        const lineIdx = columns.indexOf(descriptor.columns.line);
        const vmaxIdx = columns.indexOf(descriptor.columns.vmax);
        const wanted = descriptor.filters[0].equals;
        const values = lines.map(l => l.split(',')).filter(c => c[lineIdx] === wanted).map(c => c[vmaxIdx]);
        expect(values.length).toBeGreaterThan(1000);
        const known = values.filter(v => v !== 'NULL').map(Number);
        expect(known.every(v => Number.isFinite(v) && v >= 30 && v <= 320)).toBe(true);
        // La donnée doit rester exploitable : NULL reste marginal.
        expect(known.length / values.length).toBeGreaterThan(0.99);
    });
});

describe('service worker', () => {
    it('ne précache que des fichiers locaux existants', () => {
        const source = readFileSync('sw.js', 'utf8');
        const block = source.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/)[1];
        const urls = [...block.matchAll(/^\s*'(\.\/[^']*)'/gm)].map(match => match[1]);
        expect(urls.length).toBeGreaterThan(10);
        const missing = urls.filter(url => !existsSync(url === './' ? 'index.html' : url));
        expect(missing).toEqual([]);
        expect(urls.some(url => url.startsWith('./data/raw/'))).toBe(false);
    });
});

describe('manifestes et JSON versionnés', () => {
    it.each(['manifest.webmanifest', 'car.webmanifest', 'package.json'])('%s est un JSON valide', file => {
        expect(() => readJson(file)).not.toThrow();
    });
});
