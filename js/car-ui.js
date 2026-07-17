// js/car-ui.js
// Rendu DOM du mode voiture (car.html). Volontairement séparé de ui.js :
// la timeline/HUD du rail est centrée sur l'horaire théorique et le retard,
// alors que le mode voiture affiche progression + ETA. Les styles CSS
// (container, settings-panel, form-row, start-btn, tracking-widget) sont
// réutilisés depuis css/styles.css.

import { CAR_ROUTES } from './car-config.js';
import { formatPk } from './linearref.js';

// Icônes Font Awesome 5 par type de point de passage (widget + HUD).
const WAYPOINT_ICONS = {
    sortie:    'fas fa-sign-out-alt',
    echangeur: 'fas fa-random',
    viaduc:    'fas fa-archway',
    tunnel:    'fas fa-mountain',
    peage:     'fas fa-euro-sign',
    etape:     'fas fa-map-pin',
    depart:    'fas fa-flag',
    arrivee:   'fas fa-flag-checkered'
};

export function waypointIconHtml(type) {
    const cls = WAYPOINT_ICONS[type];
    return cls ? `<i class="${cls} wp-icon" aria-hidden="true"></i>` : '';
}

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
 * @param {object|null} data.nextWaypoint  - prochain point de passage
 *                      ({ name, type, lengthM? } — sortie/échangeur/ouvrage/étape)
 * @param {number|null} data.nextDistanceKm
 * @param {number}      data.doneKm
 * @param {number}      data.remainingKm
 * @param {number}      data.totalKm
 * @param {number}      data.speedKmh
 * @param {boolean}     data.speedReliable
 * @param {number|null} data.etaSeconds
 * @param {string|null} data.sector        - secteur géographique courant
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
    } else {
        setText('car-position', '—');
    }

    if (data.nextWaypoint) {
        const wp = data.nextWaypoint;
        const len = Number.isFinite(wp.lengthM) ? ` (${wp.lengthM} m)` : '';
        const dist = Number.isFinite(data.nextDistanceKm) ? ` — ${data.nextDistanceKm.toFixed(1)} km` : '';
        const el = document.getElementById('car-next');
        if (el) el.innerHTML = `${waypointIconHtml(wp.type)}${wp.name}${len}${dist}`;
    } else {
        setText('car-next', '—');
    }

    setText('car-sector', data.sector || '—');

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

// -- LANDSCAPE HUD (voiture) --
// Même squelette visuel que le HUD rail (ui.js) mais alimenté par les
// waypoints de l'itinéraire (sorties, péages, ouvrages) au lieu des gares,
// avec une pilule "secteur" à la place de la pilule retard — le mode voiture
// n'a pas d'horaire. Compteur calibré vitesse routière (150 km/h max).

const CAR_HUD_MAX_SPEED_KMH = 150;

// Réduit le font-size de chaque .hud-point-name pour qu'il tienne sur une
// ligne en paysage (même heuristique que le rail).
function fitCarouselNames(trackPoints) {
    if (!window.matchMedia('(orientation: landscape)').matches) return;
    trackPoints.querySelectorAll('.hud-point-name').forEach(nameEl => {
        nameEl.style.fontSize = '';
        nameEl.style.whiteSpace = 'nowrap';
        const info = nameEl.parentElement;
        if (!info) return;
        const available = info.clientWidth;
        if (available <= 0 || nameEl.scrollWidth <= available) return;
        const ratio = (available / nameEl.scrollWidth) * 0.98;
        const fitted = parseFloat(getComputedStyle(nameEl).fontSize) * ratio;
        nameEl.style.fontSize = fitted + 'px';
        if (nameEl.scrollWidth > available) {
            nameEl.style.fontSize = (fitted * (available / nameEl.scrollWidth) * 0.98) + 'px';
        }
    });
}

let _hudLastNextIdx = null;
let _hudLastRouteKey = null;
let _hudScrollAnimId = null;

function carHudPointClass(i, currentIdx, wp) {
    let cls;
    if      (i === currentIdx)     cls = 'hud-point active';
    else if (i === currentIdx + 1) cls = 'hud-point next';
    else if (i === currentIdx - 1) cls = 'hud-point passed-1';
    else if (i === currentIdx + 2) cls = 'hud-point future-1';
    else if (i < currentIdx)       cls = 'hud-point passed';
    else                           cls = 'hud-point future';
    // Bullseye pour les points "forts" (départ/arrivée, étapes, péages),
    // petit nœud plein pour le fil de la route (sorties, ouvrages).
    if (wp && ['depart', 'arrivee', 'etape', 'peage'].includes(wp.type)) cls += ' stop';
    return cls;
}

/**
 * Met à jour le HUD paysage voiture (no-op en portrait).
 * @param {object} data
 * @param {string}   data.routeKey     - clé CAR_ROUTES (détection de rebuild)
 * @param {Array}    data.waypoints    - CAR.route.waypoints (triés par routeKm)
 * @param {number}   data.doneKm
 * @param {number}   data.remainingKm
 * @param {number}   data.speedKmh
 * @param {boolean}  data.speedReliable
 * @param {Array<{v:number, reliable:boolean}>} data.speedHistory
 * @param {number|null} data.etaSeconds
 * @param {string|null} data.sector
 * @param {boolean}  data.arrived
 */
export function updateCarHUD(data) {
    if (!window.matchMedia('(orientation: landscape)').matches) return;

    // --- Dashboard : compteur ---
    const speedEl = document.getElementById('hud-speed');
    if (speedEl) {
        if (!data.speedReliable) {
            speedEl.style.setProperty('--speed-deg', '0deg');
            speedEl.innerHTML = `<span class="hud-speed-value"><i class="fas fa-signal-slash"></i></span>`;
        } else {
            const displaySpeed = Math.round(data.speedKmh);
            const arcSpeed = Math.min(displaySpeed, CAR_HUD_MAX_SPEED_KMH);
            const speedDeg = Math.round((arcSpeed / CAR_HUD_MAX_SPEED_KMH) * 240);
            speedEl.style.setProperty('--speed-deg', `${speedDeg}deg`);
            speedEl.innerHTML = `
                <span class="hud-speed-value">${displaySpeed}</span>
                <span class="hud-speed-unit">km/h</span>
            `;
        }
    }

    // --- Dashboard : graphe de vitesse ---
    const graphCanvas = document.getElementById('hud-speed-graph');
    if (graphCanvas) {
        const ctx = graphCanvas.getContext('2d');
        const w = graphCanvas.width;
        const h = graphCanvas.height;
        const history = data.speedHistory || [];
        ctx.clearRect(0, 0, w, h);

        if (history.length >= 2) {
            const points = history;
            const n = points.length;
            const maxSpeed = Math.max(...points.map(p => p.v), 1);
            const xScale = w / (n - 1);

            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const x = i * xScale;
                const y = h - (Math.min(points[i].v, maxSpeed) / maxSpeed) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.lineTo((n - 1) * xScale, h);
            ctx.lineTo(0, h);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.lineJoin = 'round';
            ctx.lineWidth = 1.5;
            for (let i = 1; i < n; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const reliable = curr.reliable !== false && prev.reliable !== false;
                ctx.beginPath();
                ctx.strokeStyle = reliable ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.35)';
                ctx.setLineDash(reliable ? [] : [4, 4]);
                ctx.moveTo((i - 1) * xScale, h - (Math.min(prev.v, maxSpeed) / maxSpeed) * h);
                ctx.lineTo(i * xScale, h - (Math.min(curr.v, maxSpeed) / maxSpeed) * h);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
    }

    // --- Dashboard : ETA + distance restante ---
    const etaEl = document.getElementById('hud-eta');
    if (etaEl) {
        if (data.arrived) {
            etaEl.innerHTML = `
                <span class="hud-eta-label">ETA</span>
                <span class="hud-eta-time">Arrivé</span>
            `;
        } else if (data.etaSeconds != null) {
            const etaDate = new Date(Date.now() + data.etaSeconds * 1000);
            const hh = String(etaDate.getHours()).padStart(2, '0');
            const mm = String(etaDate.getMinutes()).padStart(2, '0');
            etaEl.innerHTML = `
                <span class="hud-eta-label">ETA</span>
                <span class="hud-eta-time">${hh}:${mm}</span>
                <span class="hud-eta-sub">${formatDuration(data.etaSeconds)} · reste ${data.remainingKm.toFixed(0)} km</span>
            `;
        } else {
            etaEl.innerHTML = `
                <span class="hud-eta-label">ETA</span>
                <span class="hud-eta-time">—</span>
            `;
        }
    }

    // --- Dashboard : pilule secteur ---
    const sectorEl = document.getElementById('hud-sector');
    if (sectorEl) sectorEl.textContent = data.sector || '';

    // --- Carousel des points de passage ---
    const trackPoints = document.getElementById('hud-track-points');
    const waypoints = data.waypoints || [];
    if (!trackPoints || !waypoints.length) return;

    const carousel = trackPoints.closest('.hud-carousel') || trackPoints.parentElement;
    const carouselHeight = carousel ? carousel.clientHeight : window.innerHeight;

    // Prochain waypoint : premier dont le routeKm est devant nous.
    let nextIdx = waypoints.length;
    for (let i = 0; i < waypoints.length; i++) {
        if (waypoints[i].routeKm > data.doneKm) { nextIdx = i; break; }
    }
    if (data.arrived) nextIdx = waypoints.length;
    const currentIdx = nextIdx - 1;

    const routeChanged = data.routeKey !== _hudLastRouteKey;
    const idxChanged = nextIdx !== _hudLastNextIdx;

    if (!routeChanged && idxChanged) {
        _hudLastNextIdx = nextIdx;
        trackPoints.querySelectorAll('.hud-point[data-idx]').forEach(div => {
            const i = parseInt(div.dataset.idx, 10);
            div.className = carHudPointClass(i, currentIdx, waypoints[i]);
        });
        fitCarouselNames(trackPoints);
    }

    if (routeChanged) {
        _hudLastNextIdx = nextIdx;
        _hudLastRouteKey = data.routeKey;

        trackPoints.style.paddingTop = `${carouselHeight * 0.35}px`;
        trackPoints.style.paddingBottom = `${carouselHeight * 0.65}px`;
        trackPoints.innerHTML = '';

        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];
            const div = document.createElement('div');
            div.className = carHudPointClass(i, currentIdx, wp);
            div.dataset.idx = i;

            // Sous-ligne : km officiel de l'axe et/ou longueur de l'ouvrage.
            const meta = [];
            if (Number.isFinite(wp.km)) meta.push(`km ${wp.km}`);
            if (Number.isFinite(wp.lengthM)) meta.push(`${wp.lengthM} m`);

            div.innerHTML = `
                <div class="hud-point-dot"></div>
                <div class="hud-point-info">
                    <div class="hud-point-name">${waypointIconHtml(wp.type)}${wp.name}</div>
                    ${meta.length ? `<div class="hud-point-time">${meta.join(' · ')}</div>` : ''}
                    <div class="hud-point-distance"></div>
                </div>
            `;
            trackPoints.appendChild(div);
        }

        const snapTarget = trackPoints.querySelector('.hud-point.next') || trackPoints.querySelector('.hud-point.active');
        if (snapTarget && carousel) {
            carousel.scrollTop = Math.max(0, snapTarget.offsetTop + snapTarget.offsetHeight / 2 - carouselHeight * 0.40);
        }
        fitCarouselNames(trackPoints);
    }

    // Animation scroll + bornes de la ligne (identique au rail)
    if (routeChanged || idxChanged) {
        if (_hudScrollAnimId) cancelAnimationFrame(_hudScrollAnimId);
        const scrollStart = carousel.scrollTop;
        const animStart = performance.now();
        const SCROLL_DURATION = 700;
        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
        function animateScroll(now) {
            const elapsed = Math.min(now - animStart, SCROLL_DURATION);
            const progress = easeOutCubic(elapsed / SCROLL_DURATION);
            const targetEl = trackPoints.querySelector('.hud-point.next') || trackPoints.querySelector('.hud-point.active');
            if (targetEl) {
                const liveTarget = Math.max(0, targetEl.offsetTop + targetEl.offsetHeight / 2 - carouselHeight * 0.40);
                carousel.scrollTop = scrollStart + (liveTarget - scrollStart) * progress;
            }
            const allPts = trackPoints.querySelectorAll('.hud-point');
            if (allPts.length >= 1) {
                const firstPt = allPts[0];
                const lastPt = allPts[allPts.length - 1];
                trackPoints.style.setProperty('--line-top', `${firstPt.offsetTop + firstPt.offsetHeight / 2}px`);
                trackPoints.style.setProperty('--line-bottom', `${trackPoints.scrollHeight - lastPt.offsetTop - lastPt.offsetHeight / 2}px`);
            }
            if (elapsed < SCROLL_DURATION) {
                _hudScrollAnimId = requestAnimationFrame(animateScroll);
            } else {
                _hudScrollAnimId = null;
            }
        }
        _hudScrollAnimId = requestAnimationFrame(animateScroll);
    }

    // Distances le long de la route (plus juste que la distance à vol
    // d'oiseau du rail : on connaît le routeKm de chaque waypoint).
    trackPoints.querySelectorAll('.hud-point[data-idx]').forEach(div => {
        const i = parseInt(div.dataset.idx, 10);
        const wp = waypoints[i];
        if (!wp) return;
        const distEl = div.querySelector('.hud-point-distance');
        if (!distEl) return;
        const dist = Math.abs(wp.routeKm - data.doneKm);
        const arrow = wp.routeKm <= data.doneKm ? '↓' : '↑';
        distEl.textContent = `${arrow} ${dist.toFixed(1)} km`;
    });
}
