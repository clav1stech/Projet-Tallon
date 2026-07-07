// js/car-ui.js
// Rendu DOM du mode voiture (car.html). Volontairement séparé de ui.js :
// la timeline/HUD du rail est centrée sur l'horaire théorique et le retard,
// alors que le mode voiture affiche progression + ETA. Les styles CSS
// (container, settings-panel, form-row, start-btn, tracking-widget) sont
// réutilisés depuis css/styles.css.

import { CAR_ROUTES } from './car-config.js';
import { formatPk } from './linearref.js';

export function populateCarRouteSelect() {
    const select = document.getElementById('car-route-select');
    if (!select) return;
    for (const [key, cfg] of Object.entries(CAR_ROUTES)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = cfg.label;
        select.appendChild(opt);
    }
}

export function updateCarInfo(html) {
    const el = document.getElementById('car-info');
    if (el) el.innerHTML = html;
}

/**
 * Formate une durée en secondes : "1 h 05 min" / "12 min" / "< 1 min".
 */
export function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const totalMin = Math.round(seconds / 60);
    if (totalMin < 1) return '< 1 min';
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    if (h === 0) return `${min} min`;
    return `${h} h ${String(min).padStart(2, '0')} min`;
}

/**
 * Met à jour le widget de suivi voiture.
 * @param {object} data
 * @param {string}      data.legLabel      - libellé du tronçon courant (ex: "A40")
 * @param {number|null} data.pk            - PK interpolé (null hors corridor PK)
 * @param {string|null} data.line          - identifiant de ligne/route (ex: "A40")
 * @param {string|null} data.nextName      - prochain waypoint nommé (leg 'points')
 * @param {number|null} data.nextDistanceKm
 * @param {number}      data.doneKm
 * @param {number}      data.remainingKm
 * @param {number}      data.totalKm
 * @param {number}      data.speedKmh
 * @param {boolean}     data.speedReliable
 * @param {number|null} data.etaSeconds
 * @param {boolean}     data.arrived
 */
export function updateCarWidget(data) {
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setText('car-leg', data.arrived ? 'Arrivée' : (data.legLabel || '—'));

    if (data.pk != null) {
        setText('car-position', `PK ${formatPk(data.pk)}${data.line ? ` (${data.line})` : ''}`);
    } else if (data.nextName) {
        const dist = Number.isFinite(data.nextDistanceKm) ? ` — ${data.nextDistanceKm.toFixed(1)} km` : '';
        setText('car-position', `→ ${data.nextName}${dist}`);
    } else {
        setText('car-position', '—');
    }

    setText('car-km', `${data.doneKm.toFixed(1)} km / ${data.totalKm.toFixed(1)} km (reste ${data.remainingKm.toFixed(1)} km)`);
    setText('car-speed', `${Math.round(data.speedKmh)} km/h${data.speedReliable ? '' : ' (?)'}`);

    if (data.arrived) {
        setText('car-eta', 'Arrivé');
    } else if (data.etaSeconds != null) {
        const etaDate = new Date(Date.now() + data.etaSeconds * 1000);
        const hh = String(etaDate.getHours()).padStart(2, '0');
        const mm = String(etaDate.getMinutes()).padStart(2, '0');
        setText('car-eta', `${formatDuration(data.etaSeconds)} (${hh}:${mm})`);
    } else {
        setText('car-eta', '—');
    }

    const bar = document.getElementById('car-progress-bar');
    if (bar && data.totalKm > 0) {
        const pct = Math.max(0, Math.min(100, (data.doneKm / data.totalKm) * 100));
        bar.style.width = `${pct.toFixed(1)}%`;
    }
}
