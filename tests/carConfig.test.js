import { describe, it, expect } from 'vitest';
import { CAR_ROUTES } from '../js/car-config.js';

function leg(routeKey, datasetId) {
    return CAR_ROUTES[routeKey].legs.find(item => item.datasetId === datasetId);
}

describe('CAR_ROUTES — repères cartographiques validés', () => {
    const a40 = leg('MACON_COMBLOUX', 'a40-trace');
    const a406 = leg('MACON_COMBLOUX', 'a406-trace');

    it("remplace Replonges et la sortie 4 par l'aire à la position exportée", () => {
        expect(a40.waypoints.some(wp => wp.name.includes('Replonges'))).toBe(false);
        expect(a40.waypoints.some(wp => wp.name.startsWith('Sortie 4'))).toBe(false);
        expect(a40.waypoints).toContainEqual({
            pk: 12.683879,
            name: 'Aire du Musée de la Bresse',
            type: 'aire'
        });
    });

    it('intègre les recalages du fichier sur A40 et A406', () => {
        expect(a40.waypoints.find(wp => wp.name === 'Sortie 19 – Cluses')?.pk).toBe(180.210039);
        expect(a40.waypoints.find(wp => wp.name === 'Tunnel de Chamoise')?.pk).toBe(80.137326);
        expect(a40.waypoints.find(wp => wp.name === 'Péage de Viry')?.pk).toBe(126.482059);
        expect(a406.waypoints.find(wp => wp.name === 'Péage Mâcon – Val de Saône')?.pk).toBe(8.109835);
    });

    it('partage les mêmes repères corrigés avec le trajet retour', () => {
        expect(leg('COMBLOUX_MACON', 'a40-trace').waypoints).toBe(a40.waypoints);
        expect(leg('COMBLOUX_MACON', 'a406-trace').waypoints).toBe(a406.waypoints);
    });

    it('supprime Scionzier et positionne l\'échangeur A40/A410 par sens', () => {
        expect(a40.waypoints.some(wp => wp.name.includes('Scionzier'))).toBe(false);
        expect(a40.waypoints.find(wp => wp.name === 'Échangeur A40 / A410')).toMatchObject({
            pk: 156.095255,
            reversePk: 156.954016,
            lat: 46.12427410248318,
            lon: 6.327460572775609,
            reverseLat: 46.117774551373486,
            reverseLon: 6.33344726330194
        });
    });

    it('intègre les corrections spécifiques au trajet retour', () => {
        expect(a40.waypoints.find(wp => wp.name === 'Sortie 19 – Cluses')?.reversePk).toBe(181.364191);
        expect(a40.waypoints.find(wp => wp.name === 'Tunnel du Vuache')?.reversePk).toBe(118.519803);
        const combloux = CAR_ROUTES.COMBLOUX_MACON.legs[0].points[0];
        expect(combloux).toMatchObject({ lat: 45.8903069, lon: 6.6419649 });
    });
});
