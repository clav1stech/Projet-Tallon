import { describe, expect, it } from 'vitest';
import {
    getTrainPointCoordinates,
    resetTrainPointCoordinates,
    setTrainPointCoordinates,
    usesTrainVoieCoordinates
} from '../js/train-points-model.js';

describe('coordonnées directionnelles des points rail', () => {
    it('utilise les coordonnées dédiées à chaque voie pour une bifurcation', () => {
        const point = {
            type: 'bifurcation', lat: 48, lon: 2,
            lat_V1: 48.1, lon_V1: 2.1, lat_V2: 47.9, lon_V2: 1.9
        };
        expect(getTrainPointCoordinates(point, 1)).toEqual({ lat: 48.1, lon: 2.1, dedicatedToVoie: true });
        expect(getTrainPointCoordinates(point, 2)).toEqual({ lat: 47.9, lon: 1.9, dedicatedToVoie: true });
    });

    it('retombe sur lat/lon tant qu’une voie n’a pas de position dédiée', () => {
        const point = { type: 'bifurcation', lat: 48, lon: 2 };
        expect(getTrainPointCoordinates(point, 2)).toEqual({ lat: 48, lon: 2, dedicatedToVoie: false });
    });

    it('ne modifie que la voie déplacée sur une bifurcation', () => {
        const point = { type: 'bifurcation', lat: 48, lon: 2, lat_V2: 47.9, lon_V2: 1.9 };
        setTrainPointCoordinates(point, 1, 48.2, 2.2);
        expect(point).toMatchObject({ lat: 48, lon: 2, lat_V1: 48.2, lon_V1: 2.2, lat_V2: 47.9, lon_V2: 1.9 });
    });

    it('conserve des coordonnées communes pour les autres types de point', () => {
        const point = { type: 'gare', lat: 48, lon: 2 };
        setTrainPointCoordinates(point, 2, 47, 3);
        expect(point).toEqual({ type: 'gare', lat: 47, lon: 3 });
    });

    it('traite aussi les tunnels et ouvrages d’art comme des points directionnels', () => {
        const point = { type: 'ouvrage_art', lat: 48, lon: 2 };
        expect(usesTrainVoieCoordinates(point)).toBe(true);
        setTrainPointCoordinates(point, 2, 47.9, 2.1);
        expect(getTrainPointCoordinates(point, 1)).toEqual({ lat: 48, lon: 2, dedicatedToVoie: false });
        expect(getTrainPointCoordinates(point, 2)).toEqual({ lat: 47.9, lon: 2.1, dedicatedToVoie: true });
    });

    it('supprime une position par voie absente du document initial lors du reset', () => {
        const original = { type: 'bifurcation', lat: 48, lon: 2 };
        const point = { ...original, lat_V1: 48.1, lon_V1: 2.1 };
        resetTrainPointCoordinates(point, original, 1);
        expect(point).toEqual(original);
    });
});
