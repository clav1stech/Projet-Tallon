// tests/state.test.js
// Persistance de session du tracking : validation du snapshot
// (parseTrackingSnapshot est pure — l'IO localStorage n'est pas testée ici).

import { describe, it, expect } from 'vitest';
import { parseTrackingSnapshot, TRACKING_SNAPSHOT_MAX_AGE_MS } from '../js/state.js';

const T0 = 1_700_000_000_000;

function makeSnapshotJson(overrides = {}) {
    return JSON.stringify({
        lastTrustedPosition: { lat: 46.2, lon: 5.1, ts: T0 - 5000 },
        railCorridorIndex: 42,
        savedAt: T0 - 5000,
        ...overrides
    });
}

describe('parseTrackingSnapshot', () => {
    it('restaure un snapshot frais et valide', () => {
        const snap = parseTrackingSnapshot(makeSnapshotJson(), T0);
        expect(snap).toEqual({
            lastTrustedPosition: { lat: 46.2, lon: 5.1, ts: T0 - 5000 },
            railCorridorIndex: 42
        });
    });

    it('rejette un snapshot périmé (au-delà du TTL)', () => {
        const stale = makeSnapshotJson({ savedAt: T0 - TRACKING_SNAPSHOT_MAX_AGE_MS - 1 });
        expect(parseTrackingSnapshot(stale, T0)).toBeNull();
        // Limite exacte : encore accepté
        const edge = makeSnapshotJson({ savedAt: T0 - TRACKING_SNAPSHOT_MAX_AGE_MS });
        expect(parseTrackingSnapshot(edge, T0)).not.toBeNull();
    });

    it('rejette un snapshot daté dans le futur (horloge modifiée)', () => {
        expect(parseTrackingSnapshot(makeSnapshotJson({ savedAt: T0 + 60_000 }), T0)).toBeNull();
    });

    it('rejette absent / JSON corrompu / structure invalide', () => {
        expect(parseTrackingSnapshot(null, T0)).toBeNull();
        expect(parseTrackingSnapshot('', T0)).toBeNull();
        expect(parseTrackingSnapshot('{pas du json', T0)).toBeNull();
        expect(parseTrackingSnapshot('"une chaine"', T0)).toBeNull();
        expect(parseTrackingSnapshot(JSON.stringify({ savedAt: T0 }), T0)).toBeNull();
    });

    it('rejette une position incomplète ou non numérique', () => {
        const bad = makeSnapshotJson({ lastTrustedPosition: { lat: 'x', lon: 5.1, ts: T0 } });
        expect(parseTrackingSnapshot(bad, T0)).toBeNull();
        const missing = makeSnapshotJson({ lastTrustedPosition: { lat: 46.2, lon: 5.1 } });
        expect(parseTrackingSnapshot(missing, T0)).toBeNull();
    });

    it('index corridor invalide → null (la position reste restaurée)', () => {
        for (const idx of [-1, 3.5, 'x', null, undefined]) {
            const snap = parseTrackingSnapshot(makeSnapshotJson({ railCorridorIndex: idx }), T0);
            expect(snap).not.toBeNull();
            expect(snap.railCorridorIndex).toBeNull();
        }
    });
});
