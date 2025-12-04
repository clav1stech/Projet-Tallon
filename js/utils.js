// js/utils.js
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
