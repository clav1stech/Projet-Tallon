// js/utils.js
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

// Conversion d'heure sous forme "HH:MM" vers Date aujourd'hui
export function timeStringToDate(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
}

// Retourne l'heure formatée (HH:MM)
export function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
