// js/csv.js
// Parseur CSV sans dépendance + chargement de datasets décrits par un
// "descripteur" JSON (data/datasets/*.json).
//
// Objectif : les fichiers CSV réels (PK rail, PR autoroute) ne sont pas encore
// disponibles et leurs colonnes sont inconnues. TOUT ce qui dépend de la forme
// du fichier (délimiteur, séparateur décimal, noms de colonnes, format de PK,
// filtres de lignes) vit dans le descripteur : brancher le vrai fichier =
// déposer le CSV + éditer le JSON, sans toucher au code.
//
// Toutes les fonctions sont pures sauf loadDataset (fetch) → testables Vitest.

/** Erreur typée pour distinguer "fichier pas encore branché" d'un vrai bug. */
export class DatasetError extends Error {
    /**
     * @param {string} message
     * @param {'descriptor-missing'|'csv-missing'|'missing-mapping'|'missing-column'|'empty-dataset'|'bad-pk-format'} code
     */
    constructor(message, code) {
        super(message);
        this.name = 'DatasetError';
        this.code = code;
    }
}

/**
 * Parse un texte CSV en tableau d'objets clés par l'en-tête.
 * Gère les champs entre guillemets (échappement `""`), les fins de ligne
 * CRLF/LF et ignore les lignes vides.
 * Sans en-tête (`hasHeader: false`), les clés sont les index de colonnes ("0", "1", ...).
 * @param {string} text
 * @param {{ delimiter?: string, hasHeader?: boolean }} [options]
 * @returns {Array<Object<string,string>>}
 */
export function parseCsv(text, { delimiter = ',', hasHeader = true } = {}) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = String(text ?? '');

    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };

    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === delimiter) {
            pushField();
        } else if (c === '\n') {
            pushRow();
        } else if (c !== '\r') {
            field += c;
        }
    }
    if (field !== '' || row.length > 0) pushRow();

    const cleaned = rows.filter(r => r.length > 1 || (r[0] ?? '').trim() !== '');
    if (cleaned.length === 0) return [];

    if (!hasHeader) {
        return cleaned.map(r => Object.fromEntries(r.map((v, idx) => [String(idx), v])));
    }
    const [header, ...body] = cleaned;
    const keys = header.map(h => h.trim());
    return body.map(r => Object.fromEntries(keys.map((k, idx) => [k, r[idx] ?? ''])));
}

/**
 * Parse un nombre en tenant compte du séparateur décimal du fichier
 * (les exports français utilisent souvent la virgule : "46,3061").
 * @param {string|number} raw
 * @param {string} [decimalSeparator]
 * @returns {number} NaN si non parsable
 */
export function parseNumber(raw, decimalSeparator = '.') {
    if (typeof raw === 'number') return raw;
    if (raw == null) return NaN;
    let s = String(raw).trim().replace(/\s+/g, '');
    if (s === '') return NaN;
    if (decimalSeparator !== '.') {
        s = s.replace(decimalSeparator, '.');
    }
    return Number(s);
}

/**
 * Parse un point kilométrique vers des km décimaux.
 * Formats supportés (champ `pkFormat` du descripteur) :
 * - 'plus'       : "123+456" → 123.456 km (notation PK/PR SNCF & autoroutes).
 *                  Tolère une valeur décimale simple si le '+' est absent.
 * - 'decimal-km' : "123.456" (ou "123,456" selon decimalSeparator) → 123.456 km
 * - 'meters'     : "123456" → 123.456 km
 * @param {string|number} raw
 * @param {string} [format]
 * @param {string} [decimalSeparator]
 * @returns {number} PK en km décimaux, NaN si non parsable
 */
export function parsePk(raw, format = 'decimal-km', decimalSeparator = '.') {
    if (raw == null) return NaN;
    const s = String(raw).trim();
    if (s === '') return NaN;

    switch (format) {
        case 'plus': {
            const m = s.match(/^(\d+)\s*\+\s*(\d+)$/);
            if (m) return Number(m[1]) + Number(m[2]) / 1000;
            // '+' absent : tolérer une valeur décimale simple (fichiers mixtes)
            return parseNumber(s, decimalSeparator);
        }
        case 'decimal-km':
            return parseNumber(s, decimalSeparator);
        case 'meters': {
            const meters = parseNumber(s, decimalSeparator);
            return Number.isFinite(meters) ? meters / 1000 : NaN;
        }
        default:
            throw new DatasetError(`Format de PK inconnu : "${format}" (attendu : plus | decimal-km | meters)`, 'bad-pk-format');
    }
}

function matchesFilter(row, filter) {
    if (!filter || !filter.column) return true;
    const value = String(row[filter.column] ?? '').trim();
    if (filter.equals != null) return value === String(filter.equals);
    if (Array.isArray(filter.oneOf)) return filter.oneOf.map(String).includes(value);
    return true;
}

/**
 * Applique un descripteur à des lignes CSV brutes : mapping des colonnes
 * logiques {pk, line, lat, lon}, filtres, décimation, tri.
 * @param {Array<Object<string,string>>} rows - sortie de parseCsv
 * @param {object} descriptor - contenu d'un data/datasets/*.json
 * @returns {Array<{pk:number, lat:number, lon:number, line?:string}>}
 */
export function applyDescriptor(rows, descriptor) {
    const cols = descriptor.columns || {};
    const required = ['pk', 'lat', 'lon'];

    for (const key of required) {
        if (!cols[key]) {
            throw new DatasetError(
                `Descripteur "${descriptor.id}" : colonne logique "${key}" non mappée (columns.${key})`,
                'missing-mapping'
            );
        }
    }
    if (rows.length > 0) {
        for (const key of required) {
            if (!(cols[key] in rows[0])) {
                throw new DatasetError(
                    `Descripteur "${descriptor.id}" : colonne CSV "${cols[key]}" absente du fichier ` +
                    `(colonnes disponibles : ${Object.keys(rows[0]).join(', ')})`,
                    'missing-column'
                );
            }
        }
    }

    const dec = descriptor.csv?.decimalSeparator || '.';
    const pkFormat = descriptor.pkFormat || 'decimal-km';
    const filters = descriptor.filters || [];

    let out = [];
    for (const row of rows) {
        if (!filters.every(f => matchesFilter(row, f))) continue;
        const pk = parsePk(row[cols.pk], pkFormat, dec);
        const lat = parseNumber(row[cols.lat], dec);
        const lon = parseNumber(row[cols.lon], dec);
        if (!Number.isFinite(pk) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const entry = { pk, lat, lon };
        if (cols.line && cols.line in row) entry.line = String(row[cols.line]).trim();
        out.push(entry);
    }

    // Décimation optionnelle pour les très gros fichiers (1 point sur N,
    // dernier point toujours conservé pour ne pas raccourcir le corridor).
    const everyNth = Number(descriptor.everyNth) || 1;
    if (everyNth > 1) {
        out = out.filter((_, i) => i % everyNth === 0 || i === out.length - 1);
    }

    if ((descriptor.sortBy ?? 'pk') === 'pk') {
        out.sort((a, b) => a.pk - b.pk);
    }
    return out;
}

/**
 * Charge un dataset complet : descripteur (URL ou objet) puis CSV référencé.
 * @param {string|object} descriptorOrUrl - URL d'un data/datasets/*.json ou objet déjà chargé
 * @param {Function} [fetchFn] - injectable pour les tests
 * @returns {Promise<{descriptor: object, points: Array<{pk,lat,lon,line?}>}>}
 * @throws {DatasetError} descriptor-missing | csv-missing | empty-dataset | missing-column
 */
export async function loadDataset(descriptorOrUrl, fetchFn = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)) {
    if (!fetchFn) throw new Error('loadDataset : aucune implémentation de fetch disponible');

    let descriptor = descriptorOrUrl;
    if (typeof descriptorOrUrl === 'string') {
        const res = await fetchFn(descriptorOrUrl);
        if (!res.ok) {
            throw new DatasetError(`Descripteur introuvable : ${descriptorOrUrl} (HTTP ${res.status})`, 'descriptor-missing');
        }
        descriptor = await res.json();
    }

    const csvRes = await fetchFn(descriptor.file);
    if (!csvRes.ok) {
        throw new DatasetError(`CSV introuvable : ${descriptor.file} (HTTP ${csvRes.status})`, 'csv-missing');
    }
    const text = await csvRes.text();
    const rows = parseCsv(text, descriptor.csv || {});
    const points = applyDescriptor(rows, descriptor);
    if (points.length < 2) {
        throw new DatasetError(
            `Dataset "${descriptor.id}" : moins de 2 points exploitables après filtrage (${points.length})`,
            'empty-dataset'
        );
    }
    return { descriptor, points };
}
