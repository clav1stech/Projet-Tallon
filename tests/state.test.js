// tests/state.test.js
// Persistance de session du tracking rail : validation pure du snapshot,
// expiration, corruption, et restauration dans STATE avec un stockage injecté.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    STATE,
    parseTrackingSnapshot,
    saveTrackingSnapshot,
    restoreTrackingSnapshot,
    TRACKING_SNAPSHOT_MAX_AGE_MS
} from '../js/state.js';

const NOW = 1_800_000_000_000;
const SNAPSHOT_KEY = 'railTrackingSnapshot';

function snapshotJson(overrides = {}) {
    return JSON.stringify({
        lastTrustedPosition: { lat: 46.2, lon: 4.9, ts: NOW - 60_000 },
        railCorridorIndex: 1234,
        savedAt: NOW - 60_000,
        ...overrides
    });
}

function fakeStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: key => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); },
        removeItem: key => { data.delete(key); }
    };
}

describe('parseTrackingSnapshot', () => {
    it('accepte un snapshot récent et complet', () => {
        expect(parseTrackingSnapshot(snapshotJson(), NOW)).toEqual({
            lastTrustedPosition: { lat: 46.2, lon: 4.9, ts: NOW - 60_000 },
            railCorridorIndex: 1234
        });
    });

    it('rejette l\'absence de snapshot', () => {
        expect(parseTrackingSnapshot(null, NOW)).toBeNull();
        expect(parseTrackingSnapshot('', NOW)).toBeNull();
    });

    it('expire au-delà du TTL, mais pas à la limite', () => {
        const atLimit = snapshotJson({ savedAt: NOW - TRACKING_SNAPSHOT_MAX_AGE_MS });
        const beyond = snapshotJson({ savedAt: NOW - TRACKING_SNAPSHOT_MAX_AGE_MS - 1 });
        expect(parseTrackingSnapshot(atLimit, NOW)).not.toBeNull();
        expect(parseTrackingSnapshot(beyond, NOW)).toBeNull();
    });

    it('respecte un TTL personnalisé', () => {
        expect(parseTrackingSnapshot(snapshotJson(), NOW, 30_000)).toBeNull();
    });

    it('rejette une horloge incohérente (snapshot daté du futur)', () => {
        expect(parseTrackingSnapshot(snapshotJson({ savedAt: NOW + 1000 }), NOW)).toBeNull();
        expect(parseTrackingSnapshot(snapshotJson({
            lastTrustedPosition: { lat: 46.2, lon: 4.9, ts: NOW + 1000 }
        }), NOW)).toBeNull();
    });

    it('rejette un JSON corrompu ou de forme inattendue', () => {
        expect(parseTrackingSnapshot('{pas du json', NOW)).toBeNull();
        expect(parseTrackingSnapshot('42', NOW)).toBeNull();
        expect(parseTrackingSnapshot('null', NOW)).toBeNull();
        expect(parseTrackingSnapshot(snapshotJson({ savedAt: 'hier' }), NOW)).toBeNull();
        expect(parseTrackingSnapshot(snapshotJson({ lastTrustedPosition: null }), NOW)).toBeNull();
    });

    it('rejette une position incomplète ou hors du globe', () => {
        const pos = { lat: 46.2, lon: 4.9, ts: NOW - 1000 };
        for (const bad of [
            { ...pos, lat: undefined },
            { ...pos, lon: 'x' },
            { ...pos, ts: null },
            { ...pos, lat: 91 },
            { ...pos, lon: -181 }
        ]) {
            expect(parseTrackingSnapshot(snapshotJson({ lastTrustedPosition: bad }), NOW)).toBeNull();
        }
    });

    it('ignore un index de corridor invalide sans invalider la position', () => {
        for (const idx of [undefined, null, -1, 2.5, 'abc']) {
            const parsed = parseTrackingSnapshot(snapshotJson({ railCorridorIndex: idx }), NOW);
            expect(parsed.railCorridorIndex).toBeNull();
            expect(parsed.lastTrustedPosition.lat).toBe(46.2);
        }
        expect(parseTrackingSnapshot(snapshotJson({ railCorridorIndex: 0 }), NOW).railCorridorIndex).toBe(0);
    });
});

describe('saveTrackingSnapshot / restoreTrackingSnapshot', () => {
    beforeEach(() => {
        STATE.lastTrustedPosition = null;
        STATE.railCorridorIndex = null;
    });

    it('restitue à l\'identique ce qui a été sauvegardé', () => {
        const storage = fakeStorage();
        STATE.lastTrustedPosition = { lat: 45.9, lon: 4.8, ts: NOW - 5000 };
        STATE.railCorridorIndex = 77;
        saveTrackingSnapshot(NOW - 5000, storage);

        STATE.lastTrustedPosition = null;
        STATE.railCorridorIndex = null;
        expect(restoreTrackingSnapshot(NOW, storage)).toBe(true);
        expect(STATE.lastTrustedPosition).toEqual({ lat: 45.9, lon: 4.8, ts: NOW - 5000 });
        expect(STATE.railCorridorIndex).toBe(77);
    });

    it('n\'écrit rien tant qu\'aucune position n\'est de confiance', () => {
        const storage = fakeStorage();
        saveTrackingSnapshot(NOW, storage);
        expect(storage.data.size).toBe(0);
    });

    it('n\'utilise pas une clé partagée avec le mode voiture ou les réglages', () => {
        const storage = fakeStorage();
        STATE.lastTrustedPosition = { lat: 45.9, lon: 4.8, ts: NOW };
        saveTrackingSnapshot(NOW, storage);
        expect([...storage.data.keys()]).toEqual([SNAPSHOT_KEY]);
    });

    it('ne restaure rien et supprime un snapshot périmé (la position ne traîne pas)', () => {
        const storage = fakeStorage({ [SNAPSHOT_KEY]: snapshotJson({ savedAt: NOW - TRACKING_SNAPSHOT_MAX_AGE_MS - 1 }) });
        expect(restoreTrackingSnapshot(NOW, storage)).toBe(false);
        expect(STATE.lastTrustedPosition).toBeNull();
        expect(storage.data.has(SNAPSHOT_KEY)).toBe(false);
    });

    it('supprime un snapshot corrompu', () => {
        const storage = fakeStorage({ [SNAPSHOT_KEY]: '{corrompu' });
        expect(restoreTrackingSnapshot(NOW, storage)).toBe(false);
        expect(storage.data.has(SNAPSHOT_KEY)).toBe(false);
    });

    it('sans snapshot : retourne false et laisse STATE intact', () => {
        STATE.railCorridorIndex = 5;
        expect(restoreTrackingSnapshot(NOW, fakeStorage())).toBe(false);
        expect(STATE.railCorridorIndex).toBe(5);
    });

    it('un index absent du snapshot n\'écrase pas celui déjà en mémoire', () => {
        const storage = fakeStorage({ [SNAPSHOT_KEY]: snapshotJson({ railCorridorIndex: null }) });
        STATE.railCorridorIndex = 5;
        expect(restoreTrackingSnapshot(NOW, storage)).toBe(true);
        expect(STATE.railCorridorIndex).toBe(5);
    });

    it('ne lève jamais si le stockage est indisponible ou saturé', () => {
        const broken = {
            getItem() { throw new Error('SecurityError'); },
            setItem() { throw new Error('QuotaExceededError'); },
            removeItem() { throw new Error('SecurityError'); }
        };
        STATE.lastTrustedPosition = { lat: 45.9, lon: 4.8, ts: NOW };
        expect(() => saveTrackingSnapshot(NOW, broken)).not.toThrow();
        expect(restoreTrackingSnapshot(NOW, broken)).toBe(false);
        expect(restoreTrackingSnapshot(NOW, undefined)).toBe(false);
    });
});
