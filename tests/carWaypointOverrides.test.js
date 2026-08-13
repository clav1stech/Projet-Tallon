import { describe, it, expect } from 'vitest';
import {
    applyCarWaypointOverrides,
    migrateCarWaypointOverrides,
    normalizeCarWaypointOverrides,
    waypointOverrideKey
} from '../js/car-waypoint-overrides.js';

const CFG = {
    legs: [
        {
            type: 'pk-corridor', datasetId: 'a40', label: 'A40',
            waypoints: [{ name: 'Tunnel Test', pk: 10, type: 'tunnel' }]
        },
        {
            type: 'points', label: 'Ville',
            points: [{ id: 'CENTRE', name: 'Centre', lat: 46, lon: 6 }]
        }
    ]
};

describe('corrections cartographiques voiture', () => {
    it('construit des clés distinctes pour les deux sens', () => {
        expect(waypointOverrideKey(CFG.legs[0], CFG.legs[0].waypoints[0]))
            .toBe('corridor:a40:Tunnel Test:forward');
        expect(waypointOverrideKey({ ...CFG.legs[0], reverse: true }, CFG.legs[0].waypoints[0]))
            .toBe('corridor:a40:Tunnel Test:reverse');
        expect(waypointOverrideKey(CFG.legs[1], CFG.legs[1].points[0]))
            .toBe('point:CENTRE');
    });

    it('applique les corrections dans le bon sens sans muter la config', () => {
        const corrected = applyCarWaypointOverrides(CFG, {
            'corridor:a40:Tunnel Test:forward': { pk: 12.5, lat: 45.8, lon: 5.8 },
            'point:CENTRE': { lat: 45.9, lon: 6.2 }
        });
        expect(corrected.legs[0].waypoints[0]).toMatchObject({ pk: 12.5, lat: 45.8, lon: 5.8 });
        expect(corrected.legs[1].points[0]).toMatchObject({ lat: 45.9, lon: 6.2 });
        expect(CFG.legs[0].waypoints[0].pk).toBe(10);
        expect(CFG.legs[1].points[0].lat).toBe(46);
    });

    it('applique un PK retour sans modifier le PK aller', () => {
        const reverseCfg = { legs: [{ ...CFG.legs[0], reverse: true }] };
        const corrected = applyCarWaypointOverrides(reverseCfg, {
            'corridor:a40:Tunnel Test:reverse': { pk: 11.5 }
        });
        expect(corrected.legs[0].waypoints[0]).toMatchObject({ pk: 10, reversePk: 11.5 });
    });

    it('convertit un export v1 selon le trajet sélectionné', () => {
        const legacy = { version: 1, overrides: { 'corridor:a40:Tunnel Test': { pk: 11 } } };
        expect(migrateCarWaypointOverrides(legacy, { legs: [CFG.legs[0]] }))
            .toEqual({ 'corridor:a40:Tunnel Test:forward': { pk: 11 } });
        expect(migrateCarWaypointOverrides(legacy, { legs: [{ ...CFG.legs[0], reverse: true }] }))
            .toEqual({ 'corridor:a40:Tunnel Test:reverse': { pk: 11 } });
    });

    it("nettoie les corrections invalides et accepte l'enveloppe exportée", () => {
        expect(normalizeCarWaypointOverrides({
            version: 1,
            overrides: {
                ok: { pk: '2.5' },
                bad: { pk: 'x' },
                partial: { lat: 45.9 }
            }
        })).toEqual({ ok: { pk: 2.5 } });
    });
});
