import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildMasterRoutesDocument,
    loadMasterRoutes,
    validateMasterRoutes
} from '../js/master-routes-data.js';

function validData() {
    return {
        _schema: 'v3',
        points: {
            A: { name: 'A', type: 'passage', lat: 48, lon: 2 },
            B: {
                name: 'B', type: 'bifurcation', lat: 47, lon: 3,
                lat_V1: 47.1, lon_V1: 3.1, lat_V2: 46.9, lon_V2: 2.9
            }
        },
        trajets: [{ id: 'A_B', voie: 1, points: [{ id: 'A', durationToNext: 60 }, { id: 'B' }] }]
    };
}

describe('validation du schéma master routes v3', () => {
    it('accepte un document valide et ses coordonnées par voie', () => {
        expect(validateMasterRoutes(validData())).toEqual({ valid: true, errors: [] });
    });

    it('refuse une coordonnée par voie incomplète', () => {
        const data = validData();
        delete data.points.B.lon_V2;
        const result = validateMasterRoutes(data);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Point B a des coordonnées V2 invalides ou incomplètes.');
    });

    it('refuse une référence de point inconnue et une voie invalide', () => {
        const data = validData();
        data.trajets[0].voie = 3;
        data.trajets[0].points[1].id = 'INCONNU';
        const result = validateMasterRoutes(data);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.includes('voie = 1 ou voie = 2'))).toBe(true);
        expect(result.errors.some(error => error.includes('référence de point inconnue'))).toBe(true);
    });

    it('bloque la construction d’un export invalide', () => {
        const data = validData();
        data.points.A.lat = 120;
        expect(() => buildMasterRoutesDocument(data.points, data.trajets)).toThrow('Export refusé');
    });

    it('valide également les données au chargement', async () => {
        const fetchImpl = async () => ({ ok: true, json: async () => validData() });
        await expect(loadMasterRoutes(fetchImpl)).resolves.toEqual(validData());
    });

    it('accepte la source de vérité actuelle du projet', () => {
        const data = JSON.parse(readFileSync('data/masterRoutes.normalized.json', 'utf8'));
        expect(validateMasterRoutes(data)).toEqual({ valid: true, errors: [] });
    });
});
