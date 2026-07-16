// tests/csv.test.js
// Parseur CSV + descripteurs de datasets (js/csv.js).
// Les CSV réels n'existant pas encore, ces tests garantissent que TOUTE la
// variabilité attendue (délimiteur, séparateur décimal, noms de colonnes,
// format de PK, filtres) est absorbée par le descripteur, sans recodage.

import { describe, it, expect } from 'vitest';
import { parseCsv, parseNumber, parsePk, applyDescriptor, loadDataset, DatasetError } from '../js/csv.js';

describe('parseCsv', () => {
    it('parse un CSV virgule avec en-tête', () => {
        const rows = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
        expect(rows).toEqual([
            { a: '1', b: '2', c: '3' },
            { a: '4', b: '5', c: '6' }
        ]);
    });

    it('parse un CSV point-virgule (export FR)', () => {
        const rows = parseCsv('pk;lat\n12;46,3', { delimiter: ';' });
        expect(rows).toEqual([{ pk: '12', lat: '46,3' }]);
    });

    it('gère les champs entre guillemets (délimiteur et échappement "" inclus)', () => {
        const rows = parseCsv('name,val\n"Mâcon, Loché","dit ""TGV"""\n');
        expect(rows).toEqual([{ name: 'Mâcon, Loché', val: 'dit "TGV"' }]);
    });

    it('gère les fins de ligne CRLF et les lignes vides', () => {
        const rows = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');
        expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    });

    it('sans en-tête : clés = index de colonnes', () => {
        const rows = parseCsv('1,2\n3,4', { hasHeader: false });
        expect(rows).toEqual([{ '0': '1', '1': '2' }, { '0': '3', '1': '4' }]);
    });

    it('retourne [] pour un texte vide', () => {
        expect(parseCsv('')).toEqual([]);
        expect(parseCsv(null)).toEqual([]);
    });
});

describe('parseNumber', () => {
    it('parse un décimal à point', () => {
        expect(parseNumber('46.3061')).toBeCloseTo(46.3061);
    });

    it('parse un décimal à virgule avec decimalSeparator=","', () => {
        expect(parseNumber('46,3061', ',')).toBeCloseTo(46.3061);
    });

    it('tolère les espaces', () => {
        expect(parseNumber(' 12.5 ')).toBeCloseTo(12.5);
    });

    it('retourne NaN pour une valeur non parsable ou vide', () => {
        expect(parseNumber('abc')).toBeNaN();
        expect(parseNumber('')).toBeNaN();
        expect(parseNumber(null)).toBeNaN();
    });
});

describe('parsePk', () => {
    it("format 'plus' : 123+456 → 123.456 km", () => {
        expect(parsePk('123+456', 'plus')).toBeCloseTo(123.456);
        expect(parsePk('0+050', 'plus')).toBeCloseTo(0.05);
        expect(parsePk('12 + 5', 'plus')).toBeCloseTo(12.005);
    });

    it("format 'plus' : tolère une valeur décimale simple si '+' absent", () => {
        expect(parsePk('123.4', 'plus')).toBeCloseTo(123.4);
    });

    it("format 'decimal-km' avec virgule décimale", () => {
        expect(parsePk('123,456', 'decimal-km', ',')).toBeCloseTo(123.456);
    });

    it("format 'meters' : 123456 → 123.456 km", () => {
        expect(parsePk('123456', 'meters')).toBeCloseTo(123.456);
    });

    it('format inconnu → DatasetError', () => {
        expect(() => parsePk('12', 'miles')).toThrowError(DatasetError);
    });
});

const DESCRIPTOR = {
    id: 'test-ds',
    file: 'data/csv/test.csv',
    csv: { delimiter: ';', hasHeader: true, decimalSeparator: ',' },
    columns: { pk: 'pr', line: 'route', lat: 'latitude', lon: 'longitude' },
    pkFormat: 'plus',
    filters: [{ column: 'route', equals: 'A40' }],
    sortBy: 'pk'
};

const CSV_TEXT = [
    'route;pr;latitude;longitude',
    'A40;10+000;46,10;5,10',
    'A41;99+000;45,00;6,00',    // filtrée (autre route)
    'A40;0+000;46,00;5,00',     // désordre volontaire → tri par pk
    'A40;xx;46,20;5,20',        // pk invalide → ignorée
    'A40;20+500;46,20;5,20'
].join('\n');

describe('applyDescriptor', () => {
    it('mappe, filtre, ignore les lignes invalides et trie par PK', () => {
        const rows = parseCsv(CSV_TEXT, DESCRIPTOR.csv);
        const points = applyDescriptor(rows, DESCRIPTOR);
        expect(points.map(p => p.pk)).toEqual([0, 10, 20.5]);
        expect(points[0]).toMatchObject({ lat: 46.0, lon: 5.0, line: 'A40' });
    });

    it('colonne vmax optionnelle : mappée si numérique, omise sinon (NULL SNCF)', () => {
        const rows = parseCsv([
            'route;pr;latitude;longitude;vitesse',
            'A40;0+000;46,00;5,00;300',
            'A40;10+000;46,10;5,10;NULL',
            'A40;20+500;46,20;5,20;270'
        ].join('\n'), DESCRIPTOR.csv);
        const desc = { ...DESCRIPTOR, columns: { ...DESCRIPTOR.columns, vmax: 'vitesse' } };
        const points = applyDescriptor(rows, desc);
        expect(points.map(p => p.vmax)).toEqual([300, undefined, 270]);
    });

    it('sans mapping vmax, le champ est absent même si la colonne existe', () => {
        const rows = parseCsv('route;pr;latitude;longitude;vitesse\nA40;0+000;46,00;5,00;300', DESCRIPTOR.csv);
        const points = applyDescriptor(rows, DESCRIPTOR);
        expect(points[0]).not.toHaveProperty('vmax');
    });

    it('filtre oneOf', () => {
        const rows = parseCsv(CSV_TEXT, DESCRIPTOR.csv);
        const desc = { ...DESCRIPTOR, filters: [{ column: 'route', oneOf: ['A40', 'A41'] }] };
        const points = applyDescriptor(rows, desc);
        expect(points).toHaveLength(4);
    });

    it('décimation everyNth : garde 1 point sur N + le dernier', () => {
        const rows = Array.from({ length: 10 }, (_, i) => ({
            route: 'A40', pr: `${i}+000`, latitude: `46,${i}`, longitude: '5,0'
        }));
        const desc = { ...DESCRIPTOR, everyNth: 3 };
        const points = applyDescriptor(rows, desc);
        expect(points.map(p => p.pk)).toEqual([0, 3, 6, 9]);
    });

    it('colonne logique non mappée → DatasetError missing-mapping', () => {
        const desc = { ...DESCRIPTOR, columns: { pk: 'pr', lat: 'latitude' } };
        expect(() => applyDescriptor([], desc)).toThrowError(/non mappée/);
    });

    it('colonne CSV absente du fichier → DatasetError missing-column', () => {
        const rows = parseCsv('foo;bar\n1;2', { delimiter: ';' });
        try {
            applyDescriptor(rows, DESCRIPTOR);
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(DatasetError);
            expect(e.code).toBe('missing-column');
            // Le message liste les colonnes réellement disponibles (aide au re-mapping)
            expect(e.message).toContain('foo');
        }
    });
});

describe('loadDataset', () => {
    const makeFetch = (files) => async (url) => {
        if (!(url in files)) return { ok: false, status: 404 };
        return {
            ok: true,
            status: 200,
            json: async () => JSON.parse(files[url]),
            text: async () => files[url]
        };
    };

    it('charge descripteur (URL) puis CSV et retourne les points', async () => {
        const fetchFn = makeFetch({
            'data/datasets/test.json': JSON.stringify(DESCRIPTOR),
            'data/csv/test.csv': CSV_TEXT
        });
        const ds = await loadDataset('data/datasets/test.json', fetchFn);
        expect(ds.descriptor.id).toBe('test-ds');
        expect(ds.points.map(p => p.pk)).toEqual([0, 10, 20.5]);
    });

    it('descripteur introuvable → DatasetError descriptor-missing', async () => {
        const fetchFn = makeFetch({});
        await expect(loadDataset('data/datasets/absent.json', fetchFn))
            .rejects.toMatchObject({ code: 'descriptor-missing' });
    });

    it('CSV introuvable (pas encore branché) → DatasetError csv-missing', async () => {
        const fetchFn = makeFetch({
            'data/datasets/test.json': JSON.stringify(DESCRIPTOR)
        });
        await expect(loadDataset('data/datasets/test.json', fetchFn))
            .rejects.toMatchObject({ code: 'csv-missing' });
    });

    it('moins de 2 points exploitables → DatasetError empty-dataset', async () => {
        const fetchFn = makeFetch({
            'data/csv/test.csv': 'route;pr;latitude;longitude\nA40;0+000;46,0;5,0'
        });
        await expect(loadDataset(DESCRIPTOR, fetchFn))
            .rejects.toMatchObject({ code: 'empty-dataset' });
    });
});
