import { describe, expect, it } from 'vitest';
import { abbreviatePointName, buildPointLabels, choosePointLabel } from '../js/point-labels.js';

// Mesure factice : un texte « tient » s'il compte au plus `max` caractères.
const fitsWithin = max => text => text.length <= max;

describe('abréviation des noms de points', () => {
    it('n’abrège que les préfixes déclarés', () => {
        expect(abbreviatePointName('Bifurcation de Montanay')).toBe('Bif. de Montanay');
        expect(abbreviatePointName('Bifurcation vers le racc. de Bollène')).toBe('Bif. vers le racc. de Bollène');
        expect(abbreviatePointName('Macon – Loché TGV')).toBeNull();
        expect(abbreviatePointName('Tunnel de la Bifurcation')).toBeNull();
    });

    it('garde la forme longue quand elle tient sur une ligne', () => {
        expect(choosePointLabel('Bifurcation de Solers', fitsWithin(22))).toBe('Bifurcation de Solers');
    });

    it('abrège quand seule l’abréviation tient sur une ligne', () => {
        expect(choosePointLabel('Bifurcation de Montanay', fitsWithin(18))).toBe('Bif. de Montanay');
    });

    it('garde la forme longue quand même l’abréviation déborde', () => {
        expect(choosePointLabel('Bifurcation de Chevry-Cossigny', fitsWithin(18))).toBe('Bifurcation de Chevry-Cossigny');
    });

    it('suit la taille de l’écran : un même nom change de forme selon la place', () => {
        const name = 'Bifurcation de Vergigny';
        expect(choosePointLabel(name, fitsWithin(18))).toBe('Bif. de Vergigny');
        expect(choosePointLabel(name, fitsWithin(30))).toBe(name);
    });

    it('ne mesure pas un nom sans abréviation et décide une fois par nom', () => {
        const measured = [];
        const fits = text => { measured.push(text); return text.length <= 18; };
        const labels = buildPointLabels(['Paris-Lyon', 'Bifurcation de Pasilly', 'Bifurcation de Pasilly'], fits);
        expect(labels.get('Paris-Lyon')).toBe('Paris-Lyon');
        expect(labels.get('Bifurcation de Pasilly')).toBe('Bif. de Pasilly');
        expect(measured).toEqual(['Bifurcation de Pasilly', 'Bif. de Pasilly']);
    });
});
