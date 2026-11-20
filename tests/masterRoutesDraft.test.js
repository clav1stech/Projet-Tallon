import { describe, expect, it } from 'vitest';
import {
    MASTER_ROUTES_DRAFT_KEY,
    readMasterRoutesDraft,
    resolveEditableMasterRoutes,
    writeMasterRoutesDraft
} from '../js/master-routes-draft.js';

function memoryStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        has: key => values.has(key)
    };
}

function fileData() {
    return {
        _schema: 'v3',
        points: { A: { name: 'A', lat: 48, lon: 2 }, B: { name: 'B', lat: 47, lon: 3 } },
        trajets: [{ id: 'A_B', voie: 1, points: [{ id: 'A', durationToNext: 60 }, { id: 'B' }] }]
    };
}

describe('brouillon partagé des éditeurs', () => {
    it('enregistre et relit un brouillon qui diffère du fichier', () => {
        const storage = memoryStorage();
        const draft = fileData();
        draft.trajets[0].points[0].durationToNext = 90;
        expect(writeMasterRoutesDraft(storage, draft, fileData(), 1234)).toBe(1234);
        expect(readMasterRoutesDraft(storage)).toEqual({ data: draft, savedAt: 1234 });

        const resolved = resolveEditableMasterRoutes(fileData(), readMasterRoutesDraft(storage), storage);
        expect(resolved.draftSavedAt).toBe(1234);
        expect(resolved.data.trajets[0].points[0].durationToNext).toBe(90);
    });

    it('efface un brouillon redevenu identique au fichier', () => {
        const storage = memoryStorage();
        const draft = fileData();
        draft.points.A.lat = 48.5;
        writeMasterRoutesDraft(storage, draft, fileData());
        expect(writeMasterRoutesDraft(storage, fileData(), fileData())).toBeNull();
        expect(storage.has(MASTER_ROUTES_DRAFT_KEY)).toBe(false);

        storage.setItem(MASTER_ROUTES_DRAFT_KEY, JSON.stringify({ savedAt: 1, data: fileData() }));
        const resolved = resolveEditableMasterRoutes(fileData(), readMasterRoutesDraft(storage), storage);
        expect(resolved.draftSavedAt).toBeNull();
        expect(storage.has(MASTER_ROUTES_DRAFT_KEY)).toBe(false);
    });

    it('ignore un brouillon corrompu ou invalide et refuse d’en écrire un', () => {
        const storage = memoryStorage();
        storage.setItem(MASTER_ROUTES_DRAFT_KEY, '{oups');
        expect(readMasterRoutesDraft(storage)).toBeNull();
        storage.setItem(MASTER_ROUTES_DRAFT_KEY, JSON.stringify({ savedAt: 1, data: { _schema: 'v2' } }));
        expect(readMasterRoutesDraft(storage)).toBeNull();

        const invalid = fileData();
        invalid.trajets[0].voie = 3;
        expect(() => writeMasterRoutesDraft(storage, invalid, fileData())).toThrow(/Brouillon non enregistré/);
    });

    it('fonctionne sans stockage', () => {
        expect(readMasterRoutesDraft(null)).toBeNull();
        expect(writeMasterRoutesDraft(null, fileData(), fileData())).toBeNull();
        const resolved = resolveEditableMasterRoutes(fileData(), null, null);
        expect(resolved.data).toEqual(fileData());
        expect(resolved.data).not.toBe(resolved.fileData);
    });
});
