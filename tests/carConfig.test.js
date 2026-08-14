import { describe, it, expect } from 'vitest';
import { CAR_ROUTES } from '../js/car-config.js';

function leg(routeKey, datasetId) {
    return CAR_ROUTES[routeKey].legs.find(item => item.datasetId === datasetId);
}

describe('CAR_ROUTES — repères cartographiques validés', () => {
    const a40 = leg('MACON_COMBLOUX', 'a40-trace');
    const a406 = leg('MACON_COMBLOUX', 'a406-trace');
    const d1212 = leg('MACON_COMBLOUX', 'd1212-trace');

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
        expect(a40.waypoints.find(wp => wp.name === 'Tunnel de Chamoise')).toMatchObject({
            pk: 80.021323,
            reversePk: 83.387975
        });
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
        expect(a40.waypoints.find(wp => wp.name === 'Tunnel du Vuache')?.reversePk).toBe(118.509711);
        const combloux = CAR_ROUTES.COMBLOUX_MACON.legs[0].points[0];
        expect(combloux).toMatchObject({ lat: 45.8903069, lon: 6.6419649 });
    });

    it('intègre les coordonnées corrigées du col de Ceignes dans les deux sens', () => {
        expect(a40.waypoints.find(wp => wp.name === 'Col de Ceignes')).toMatchObject({
            pk: 74.095046,
            reversePk: 74.104584,
            lat: 46.1298136,
            lon: 5.5058963,
            reverseLat: 46.1298498,
            reverseLon: 5.5060093,
            type: 'col'
        });
    });

    it('supprime la sortie 13 et ajoute Sallanches Mairie dans les deux sens', () => {
        expect(a40.waypoints.some(wp => wp.name === 'Sortie 13 – Saint-Julien-en-Genevois')).toBe(false);
        expect(d1212.waypoints).toContainEqual({
            pk: 0.000224,
            reversePk: 0.000224,
            lat: 45.93641811218994,
            lon: 6.63016378635892,
            reverseLat: 45.93641811218994,
            reverseLon: 6.63016378635892,
            name: 'Sallanches (Mairie)',
            type: 'etape'
        });
        expect(leg('COMBLOUX_MACON', 'd1212-trace').waypoints).toBe(d1212.waypoints);
    });

    it('utilise Mâcon-Loché TGV comme terminus ouest dans les deux sens', () => {
        const forward = CAR_ROUTES.MACON_COMBLOUX.legs[0].points[0];
        const reverseLegs = CAR_ROUTES.COMBLOUX_MACON.legs;
        const reverse = reverseLegs[reverseLegs.length - 1].points[0];
        expect(forward).toMatchObject({
            id: 'MACON_LOCHE_TGV',
            lat: 46.283055555555556,
            lon: 4.777777777777778
        });
        expect(reverse).toBe(forward);
    });

    it('permute les positions aller et retour des ouvrages', () => {
        const structures = a40.waypoints.filter(wp => Number.isFinite(wp.lengthM));
        expect(structures).toHaveLength(15);
        expect(structures.every(wp => Number.isFinite(wp.reversePk) && wp.pk < wp.reversePk)).toBe(true);
        expect(structures.find(wp => wp.name === 'Tunnel de Chamoise')).toMatchObject({
            pk: 80.021323,
            reversePk: 83.387975,
            lengthM: 3300
        });
        expect(structures.find(wp => wp.name === 'Tunnel du Vuache')).toMatchObject({
            pk: 117.14765,
            reversePk: 118.509711,
            lengthM: 1400
        });
    });

    it('conserve les corrections antérieures et intègre les nouveaux recalages précis', () => {
        expect(a40.waypoints.find(wp => wp.name === 'Sortie 5 – Bourg-en-Bresse nord')).toMatchObject({
            pk: 26.67536,
            reversePk: 27.323019,
            reverseLat: 46.2614211,
            reverseLon: 5.1689784
        });
        expect(a40.waypoints.find(wp => wp.name === 'Échangeur A39 (Dijon)')).toMatchObject({
            pk: 33.353851,
            reversePk: 34.436188,
            reverseLat: 46.2519663,
            reverseLon: 5.2568084
        });
        expect(a40.waypoints.find(wp => wp.name === 'Sortie 6 – Viriat / Bourg centre')?.reversePk).toBe(37.223399);
        expect(a40.waypoints.find(wp => wp.name === 'Sortie 7 – Bourg-en-Bresse sud / Ceyzériat')?.reversePk).toBe(47.712039);
        expect(a40.waypoints.find(wp => wp.name === "Échangeur A42 (Pont-d'Ain, Lyon)")?.reversePk).toBe(58.465484);

        expect(a40.waypoints.find(wp => wp.name === 'Viaduc de Charix')).toMatchObject({
            pk: 89.508921,
            reversePk: 90.00468,
            lat: 46.1699386,
            lon: 5.6768638,
            reverseLat: 46.1712339,
            reverseLon: 5.6831647
        });
        expect(a40.waypoints.find(wp => wp.name === 'Viaduc des Neyrolles')).toMatchObject({
            pk: 84.350732,
            reversePk: 85.108187,
            lat: 46.1414534,
            lon: 5.6258576,
            reverseLat: 46.1458585,
            reverseLon: 5.6333229
        });
    });
});
