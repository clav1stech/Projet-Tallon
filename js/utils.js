// js/utils.js

/**
 * Retourne la voie de circulation d'une master route.
 * Voie 1 = Paris → Province, voie 2 = Province → Paris.
 * Se base sur le champ `voie`, avec repli sur les anciennes valeurs de `direction`.
 * @param {object} route - Objet master route
 * @returns {1|2|null}
 */
export function getVoieForRoute(route) {
    if (route?.voie === 1 || route?.voie === 2) return route.voie;
    const dir = (route?.direction || '').toLowerCase();
    if (dir === 'south-north') return 1;
    if (dir === 'north-south') return 2;
    return null;
}
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

// Conversion d'heure sous forme "HH:MM" vers Date aujourd'hui
export function timeStringToDate(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return new Date();
    const [hStr, mStr] = timeStr.split(':');
    const now = new Date();
    now.setHours(Number(hStr) || 0, Number(mStr) || 0, 0, 0);
    return now;
}

// Retourne l'heure formatée (HH:MM)
export function formatTime(date) {
    if (!(date instanceof Date)) return '';
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}
