// js/master-routes-draft.js
// Brouillon local de masterRoutes partagé par les éditeurs (trajets, profil de
// vitesse, carte rail). Une correction faite dans l'un se voit dans les autres
// avant même l'export ; le fichier versionné reste la seule source de l'app,
// qui ne lit jamais ce brouillon. Le stockage est injecté : sans lui (navigation
// privée, stockage bloqué), les éditeurs fonctionnent sans persistance.

import { loadMasterRoutes, validateMasterRoutes } from './master-routes-data.js';

export const MASTER_ROUTES_DRAFT_KEY = 'tallon.editors.masterRoutesDraft.v1';

/** localStorage s'il est utilisable, sinon null (l'accès lui-même peut lever). */
export function browserStorage() {
    try {
        const storage = globalThis.localStorage;
        if (!storage) return null;
        const probe = `${MASTER_ROUTES_DRAFT_KEY}.probe`;
        storage.setItem(probe, '1');
        storage.removeItem(probe);
        return storage;
    } catch {
        return null;
    }
}

/** @returns {{ data:object, savedAt:number }|null} null si absent ou invalide */
export function readMasterRoutesDraft(storage) {
    try {
        const raw = storage?.getItem(MASTER_ROUTES_DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!validateMasterRoutes(parsed?.data).valid || !Number.isFinite(parsed.savedAt)) return null;
        return { data: parsed.data, savedAt: parsed.savedAt };
    } catch {
        return null;
    }
}

/**
 * Enregistre le brouillon, ou l'efface s'il ne diffère plus du fichier : un
 * brouillon identique au fichier n'apprendrait rien et masquerait la mise à
 * jour suivante du fichier.
 * @returns {number|null} horodatage du brouillon, null s'il n'y en a plus
 */
export function writeMasterRoutesDraft(storage, data, fileData, now = Date.now()) {
    if (!storage) return null;
    if (sameDocument(data, fileData)) {
        clearMasterRoutesDraft(storage);
        return null;
    }
    const validation = validateMasterRoutes(data);
    if (!validation.valid) throw new Error(`Brouillon non enregistré : ${validation.errors.join(' ')}`);
    storage.setItem(MASTER_ROUTES_DRAFT_KEY, JSON.stringify({ savedAt: now, data }));
    return now;
}

export function clearMasterRoutesDraft(storage) {
    try {
        storage?.removeItem(MASTER_ROUTES_DRAFT_KEY);
    } catch {
        // Stockage devenu inaccessible : rien à effacer.
    }
}

export function sameDocument(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Données à éditer : le brouillon s'il existe et diffère du fichier, sinon le
 * fichier. Un brouillon redevenu identique (fichier remplacé par son export)
 * est effacé au passage.
 * @returns {{ data:object, fileData:object, draftSavedAt:number|null }}
 */
export function resolveEditableMasterRoutes(fileData, draft, storage) {
    if (draft && !sameDocument(draft.data, fileData)) {
        return { data: structuredClone(draft.data), fileData, draftSavedAt: draft.savedAt };
    }
    if (draft) clearMasterRoutesDraft(storage);
    return { data: structuredClone(fileData), fileData, draftSavedAt: null };
}

export async function loadEditableMasterRoutes({ storage = browserStorage(), fetchImpl } = {}) {
    const fileData = await loadMasterRoutes(fetchImpl);
    return { ...resolveEditableMasterRoutes(fileData, readMasterRoutesDraft(storage), storage), storage };
}
