import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { MAIN_ROUTES } from '../js/routes-config.js';
import { CAR_ROUTES } from '../js/car-config.js';
import { reverseRouteKey, routeEndpoints } from '../js/car-session.js';
import { buildRouteSegments } from '../js/route-speed.js';
import { POINT_NAME_ABBREVIATIONS, ROUTE_SPEED_BOUNDS_KMH } from '../js/train-config.js';

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
const KNOWN_ANOMALIES = new Set([]);

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

describe('masterRoutes : noms en toutes lettres', () => {
    // L'abréviation est une décision d'affichage, prise selon la place à
    // l'écran (js/point-labels.js) : une forme courte dans les données
    // l'imposerait partout, même là où le nom complet tient.
    it('aucun nom ne commence par une forme abrégée', () => {
        const abbreviated = Object.entries(master.points)
            .filter(([, point]) => POINT_NAME_ABBREVIATIONS.some(rule => point.name.startsWith(rule.short)))
            .map(([id, point]) => `${id} : ${point.name}`);
        expect(abbreviated).toEqual([]);
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

// Durées théoriques physiquement impossibles (au-delà de la vitesse de ligne)
// ou anormalement longues : presque toujours une durée rangée sur le mauvais
// segment. Elles faussent le retard affiché de plusieurs minutes pendant la
// traversée, même quand le total du trajet est juste. Écarts connus,
// « trajet|départ|arrivée », à corriger sur demande explicite.
const KNOWN_SPEED_ANOMALIES = new Set([]);

describe('masterRoutes : vitesses moyennes plausibles', () => {
    const { min, max } = ROUTE_SPEED_BOUNDS_KMH;
    const anomaliesOf = route => buildRouteSegments(master.points, route)
        .filter(segment => segment.status !== 'ok')
        .map(segment => ({
            key: `${route.id}|${segment.fromId}|${segment.toId}`,
            label: `${segment.fromName} → ${segment.toName} : ${segment.durationS} s pour `
                + `${segment.distanceKm.toFixed(2)} km (${Math.round(segment.speedKmh ?? 0)} km/h)`
        }));

    it.each(master.trajets.map(route => [route.id, route]))(
        `%s : chaque segment entre ${min} et ${max} km/h`,
        (_id, route) => {
            const unexpected = anomaliesOf(route).filter(anomaly => !KNOWN_SPEED_ANOMALIES.has(anomaly.key));
            expect(unexpected.map(anomaly => anomaly.label)).toEqual([]);
        }
    );

    it('les écarts connus sont toujours d’actualité', () => {
        const current = new Set(master.trajets.flatMap(route => anomaliesOf(route).map(anomaly => anomaly.key)));
        const fixed = [...KNOWN_SPEED_ANOMALIES].filter(key => !current.has(key));
        expect(fixed, 'corrigés : retirer de KNOWN_SPEED_ANOMALIES').toEqual([]);
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

    it('chaque itinéraire voiture nomme ses extrémités et possède son sens retour', () => {
        for (const key of Object.keys(CAR_ROUTES)) {
            expect(routeEndpoints(CAR_ROUTES, key), key).not.toBeNull();
            expect(reverseRouteKey(CAR_ROUTES, key), key).not.toBeNull();
        }
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

    // Le conteneur iOS n'embarque que le précache (ios/copy-web.mjs) et n'a
    // pas de réseau de repli : un module importé mais non précaché casserait
    // la page — et donc le passage d'un mode à l'autre — une fois embarquée.
    it.each([
        'index.html', 'car.html', 'master-editor.html', 'route-profile.html',
        'train-points-editor.html', 'car-points-editor.html'
    ])('%s : page, styles et modules tous précachés', page => {
        const source = readFileSync('sw.js', 'utf8');
        const block = source.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/)[1];
        const precached = new Set([...block.matchAll(/^\s*'\.\/([^']*)'/gm)].map(match => match[1]));
        const html = readFileSync(page, 'utf8');
        const needed = new Set([page]);
        for (const match of html.matchAll(/(?:href|src)="([^"#]+\.(?:css|js|webmanifest|png))"/g)) {
            if (!match[1].startsWith('http')) needed.add(match[1]);
        }
        const queue = [...needed].filter(file => file.endsWith('.js'));
        while (queue.length) {
            const file = queue.pop();
            for (const match of readFileSync(file, 'utf8').matchAll(/from '\.\/([^']+)'/g)) {
                const dependency = `js/${match[1]}`;
                if (!needed.has(dependency)) { needed.add(dependency); queue.push(dependency); }
            }
        }
        expect([...needed].filter(file => !precached.has(file))).toEqual([]);
    });

    it('chaque mode renvoie vers la page de l’autre', () => {
        expect(readFileSync('index.html', 'utf8')).toMatch(/id="mode-switch"[^>]*href="car\.html"/);
        expect(readFileSync('car.html', 'utf8')).toMatch(/id="mode-switch"[^>]*href="index\.html"/);
    });
});

describe('manifestes et JSON versionnés', () => {
    it.each(['manifest.webmanifest', 'car.webmanifest', 'package.json'])('%s est un JSON valide', file => {
        expect(() => readJson(file)).not.toThrow();
    });
});
