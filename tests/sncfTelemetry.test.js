// tests/sncfTelemetry.test.js
import { describe, it, expect } from 'vitest';
import {
    createSncfTracker, describeSncfFailures, noteSncfFix, parseSncfResponse, pickLocationSource
} from '../js/sncf-telemetry.js';
import { SNCF_RETRY_MS, SNCF_STALE_MS } from '../js/train-config.js';

const ok = (data, status = 200) => ({ ok: true, status, body: JSON.stringify(data) });
const FIX = { success: true, latitude: 46.2, longitude: 4.8, speed: 80, timestamp: 1_720_000_000 };

describe('parseSncfResponse', () => {
    it('convertit m/s → km/h et secondes → ms, au format geolocation', () => {
        const result = parseSncfResponse(ok(FIX));
        expect(result.ok).toBe(true);
        expect(result.fix.coords).toEqual({ latitude: 46.2, longitude: 4.8, accuracy: 15, speed: 288 });
        expect(result.routerTs).toBe(1_720_000_000_000);
    });

    it('vitesse absente : non renseignée, jamais nulle', () => {
        const result = parseSncfResponse(ok({ ...FIX, speed: null }));
        expect(result.fix.coords.speed).toBeUndefined();
    });

    it('sans horodatage : routerTs nul', () => {
        expect(parseSncfResponse(ok({ ...FIX, timestamp: undefined })).routerTs).toBeNull();
    });

    it('portail captif : page HTML ou redirection', () => {
        expect(parseSncfResponse({ ok: true, status: 200, body: '  <!doctype html><html>' }).kind).toBe('captive');
        const redirect = parseSncfResponse({ ok: true, status: 302, body: '', location: 'https://portail.example/login' });
        expect(redirect.kind).toBe('captive');
        expect(redirect.message).toContain('portail.example');
    });

    it('distingue HTTP, JSON illisible et absence de position', () => {
        expect(parseSncfResponse({ ok: true, status: 503, body: '{}' }).kind).toBe('http');
        expect(parseSncfResponse({ ok: true, status: 200, body: 'pas du json' }).kind).toBe('invalid');
        expect(parseSncfResponse(ok({ success: false })).kind).toBe('no-fix');
        expect(parseSncfResponse(ok({ success: true, latitude: null, longitude: 4 })).kind).toBe('no-fix');
    });

    it('relaie les échecs réseau qualifiés par le transport natif', () => {
        const result = parseSncfResponse({ ok: false, kind: 'local-network', detail: 'NSURLErrorDomain -1009' });
        expect(result).toMatchObject({ ok: false, kind: 'local-network' });
        expect(result.message).toContain('Réseau local');
        expect(result.message).toContain('-1009');
        expect(parseSncfResponse({ ok: false, kind: 'inconnu' }).message).toBe('inconnu');
        expect(parseSncfResponse(undefined).kind).toBe('unreachable');
    });
});

describe('describeSncfFailures', () => {
    it('fusionne les causes identiques des deux endpoints', () => {
        const timeout = parseSncfResponse({ ok: false, kind: 'timeout' });
        const captive = parseSncfResponse({ ok: true, status: 200, body: '<html>' });
        expect(describeSncfFailures([timeout, timeout])).toBe(timeout.message);
        expect(describeSncfFailures([timeout, captive])).toBe(`${timeout.message} ; ${captive.message}`);
        expect(describeSncfFailures([])).toBeTruthy();
    });
});

describe('noteSncfFix', () => {
    it('horodatage qui avance : position neuve', () => {
        const tracker = createSncfTracker();
        expect(noteSncfFix(tracker, 1000, 0)).toBe('fresh');
        expect(noteSncfFix(tracker, 2000, 1000)).toBe('fresh');
    });

    it('horodatage figé : doublon puis périmé, mesuré sur l’horloge du téléphone', () => {
        const tracker = createSncfTracker();
        noteSncfFix(tracker, 1000, 0);
        expect(noteSncfFix(tracker, 1000, SNCF_STALE_MS)).toBe('duplicate');
        expect(noteSncfFix(tracker, 1000, SNCF_STALE_MS + 1)).toBe('stale');
        // Reprise de la télémétrie : de nouveau neuve.
        expect(noteSncfFix(tracker, 5000, SNCF_STALE_MS + 2)).toBe('fresh');
    });

    it('sans horodatage routeur : toujours neuve (fraîcheur non mesurable)', () => {
        const tracker = createSncfTracker();
        expect(noteSncfFix(tracker, null, 0)).toBe('fresh');
        expect(noteSncfFix(tracker, null, SNCF_STALE_MS * 5)).toBe('fresh');
    });
});

describe('pickLocationSource', () => {
    it('source active conservée hors repli', () => {
        expect(pickLocationSource({ preferred: 'sncf', active: 'sncf', failedAt: 0 }, 0)).toBe('sncf');
        expect(pickLocationSource({ preferred: 'geo', active: 'geo', failedAt: null }, 0)).toBe('geo');
    });

    // Une tentative plus rapprochée que le seuil de péremption relirait le
    // même horodatage comme un simple doublon : ni retour, ni nouvel échec daté.
    it('l’intervalle de retour dépasse le seuil de péremption', () => {
        expect(SNCF_RETRY_MS).toBeGreaterThan(SNCF_STALE_MS);
    });

    it('repli GPS : retour tenté une fois l’intervalle écoulé', () => {
        const fallback = { preferred: 'sncf', active: 'geo', failedAt: 1000 };
        expect(pickLocationSource(fallback, 1000 + SNCF_RETRY_MS - 1)).toBe('geo');
        expect(pickLocationSource(fallback, 1000 + SNCF_RETRY_MS)).toBe('sncf');
        expect(pickLocationSource({ ...fallback, failedAt: null }, 0)).toBe('sncf');
    });
});
