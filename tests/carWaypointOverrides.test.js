import { describe, it, expect } from 'vitest';
import {
    applyCarWaypointOverrides,
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
    it('construit des clés stables partagées entre les deux sens', () => {
        expect(waypointOverrideKey(CFG.legs[0], CFG.legs[0].waypoints[0]))
            .toBe('corridor:a40:Tunnel Test');
        expect(waypointOverrideKey(CFG.legs[1], CFG.legs[1].points[0]))
            .toBe('point:CENTRE');
    });

    it('applique un PK corrigé et des coordonnées manuelles sans muter la config', () => {
        const corrected = applyCarWaypointOverrides(CFG, {
            'corridor:a40:Tunnel Test': { pk: 12.5 },
            'point:CENTRE': { lat: 45.9, lon: 6.2 }
        });
        expect(corrected.legs[0].waypoints[0].pk).toBe(12.5);
        expect(corrected.legs[1].points[0]).toMatchObject({ lat: 45.9, lon: 6.2 });
        expect(CFG.legs[0].waypoints[0].pk).toBe(10);
        expect(CFG.legs[1].points[0].lat).toBe(46);
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
