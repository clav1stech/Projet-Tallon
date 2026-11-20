// js/point-labels.js
// Choix entre forme longue et abrégée d'un nom de point. Règle pure : la mesure
// (« ce texte tient-il sur une ligne au plus grand format ? ») est fournie par
// le rendu, qui seul connaît la géométrie de l'écran.

import { POINT_NAME_ABBREVIATIONS } from './train-config.js';

/** Forme abrégée d'un nom, ou null s'il n'en a pas. */
export function abbreviatePointName(name, abbreviations = POINT_NAME_ABBREVIATIONS) {
    const text = String(name ?? '');
    const rule = abbreviations.find(item => text.startsWith(item.prefix));
    return rule ? rule.short + text.slice(rule.prefix.length) : null;
}

/**
 * Forme longue si elle tient sur une ligne ; forme abrégée seulement si c'est
 * elle qui permet d'y tenir. Quand même l'abréviation déborde, elle ne sert à
 * rien : on garde le nom en toutes lettres.
 * @param {string} name - nom complet, tel que stocké
 * @param {(text: string) => boolean} fitsOnOneLine - mesure au format « prochain point »
 */
export function choosePointLabel(name, fitsOnOneLine, abbreviations = POINT_NAME_ABBREVIATIONS) {
    const short = abbreviatePointName(name, abbreviations);
    if (!short || fitsOnOneLine(name)) return name;
    return fitsOnOneLine(short) ? short : name;
}

/** Libellé affiché de chaque nom distinct : Map nom complet → libellé. */
export function buildPointLabels(names, fitsOnOneLine, abbreviations = POINT_NAME_ABBREVIATIONS) {
    const labels = new Map();
    for (const name of names) {
        if (!labels.has(name)) labels.set(name, choosePointLabel(name, fitsOnOneLine, abbreviations));
    }
    return labels;
}
