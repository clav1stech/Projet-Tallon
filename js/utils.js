// js/utils.js

// Seuils d'affichage du retard : en dessous, l'écart n'est ni annoncé ni
// répercuté sur les heures projetées. L'asymétrie est voulue — une minute de
// retard se voit, une avance de moins de trois minutes se résorbe à quai.
export const LATE_DISPLAY_THRESHOLD_MS = 60_000;
export const EARLY_DISPLAY_THRESHOLD_MS = -180_000;

/**
 * Retard retenu pour l'affichage : aligné sur la minute entière (comme la
 * pilule du HUD) et nul sous les seuils, pour que la pilule, l'ETA et les
 * heures projetées de la timeline racontent toujours la même chose.
 * @param {number} delayMs - retard courant (négatif = avance)
 * @returns {number} décalage en ms à appliquer aux heures théoriques
 */
export function alignDelayForDisplay(delayMs) {
    if (!Number.isFinite(delayMs)) return 0;
    if (delayMs <= LATE_DISPLAY_THRESHOLD_MS && delayMs >= EARLY_DISPLAY_THRESHOLD_MS) return 0;
    const minutes = Math.floor(Math.abs(delayMs) / 60_000);
    return (delayMs >= 0 ? 1 : -1) * minutes * 60_000;
}

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
