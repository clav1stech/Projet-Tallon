// js/ui.js
import { STATE, saveSettings } from './state.js';
import { formatTime, timeStringToDate } from './utils.js';
import { haversineDistance } from './geo.js';

// Configuration des routes principales (départ Paris)
export const MAIN_ROUTES = {
    PARIS_TO_LPD: {
        label: 'Paris → Lyon-Part-Dieu',
        masterRouteId: 'PAR_LPD_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'LYON_PART_DIEU',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' }
        ]
    },
    PARIS_TO_MACON: {
        label: 'Paris → Mâcon',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'MACON_LOCHE',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    PARIS_TO_MARSEILLE: {
        label: 'Paris → Marseille',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'MARSEILLE_ST_CHARLES',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'LYON_ST_EX', label: 'Lyon-Saint-Exupéry TGV' },
            { id: 'VALENCE_TGV', label: 'Valence TGV' },
            { id: 'AVIGNON_TGV', label: 'Avignon TGV' },
            { id: 'AIX_TGV', label: 'Aix-en-Provence TGV' }
        ]
    },
    LPD_TO_PARIS: {
        label: 'Lyon-Part-Dieu → Paris',
        masterRouteId: 'PAR_LPD_SUD',
        startPointId: 'LYON_PART_DIEU',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    MACON_TO_PARIS: {
        label: 'Mâcon → Paris',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'MACON_LOCHE',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    MARSEILLE_TO_PARIS: {
        label: 'Marseille → Paris',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'MARSEILLE_ST_CHARLES',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'AIX_TGV', label: 'Aix-en-Provence TGV' },
            { id: 'AVIGNON_TGV', label: 'Avignon TGV' },
            { id: 'VALENCE_TGV', label: 'Valence TGV' },
            { id: 'LYON_ST_EX', label: 'Lyon-Saint-Exupéry TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    }
};

// -- FONCTIONS UI PRINCIPALES --

export function populateTrajetDropdown() {
    const trajetSelect = document.getElementById('routeSelect');
    if (!trajetSelect) return;

    trajetSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Choisir la destination --';
    trajetSelect.appendChild(placeholder);

    Object.entries(MAIN_ROUTES).forEach(([key, route]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = route.label;
        trajetSelect.appendChild(opt);
    });

    trajetSelect.value = STATE.selectedMainRouteKey || '';
}

// Affiche les cases à cocher des arrêts intermédiaires pour la route sélectionnée
export function renderStopCheckboxes(mainRouteKey, selectedStopIds = [], onChange = null) {
    const container = document.getElementById('stopCheckboxes');
    const wrapper = document.getElementById('stopsRow');
    if (!container || !wrapper) return;

    container.innerHTML = '';
    const config = MAIN_ROUTES[mainRouteKey];

    if (!config) {
        wrapper.style.display = 'flex';
        container.innerHTML = '<span class="hint">Sélectionnez une destination pour afficher les arrêts.</span>';
        return;
    }

    wrapper.style.display = 'flex';

    config.stopOptions.forEach(stop => {
        const labelEl = document.createElement('label');
        labelEl.className = 'checkbox-pill';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = stop.id;
        input.checked = selectedStopIds.includes(stop.id);

        input.addEventListener('change', () => {
            const values = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
            if (typeof onChange === 'function') {
                onChange(values);
            }
        });

        const span = document.createElement('span');
        span.textContent = stop.label;

        labelEl.appendChild(input);
        labelEl.appendChild(span);
        container.appendChild(labelEl);
    });
}

// Appelé depuis app.js après ajout des listeners, pour gérer le changement de route
export function setupLocationMethodListener() {
    const locationRadios = document.querySelectorAll('input[name="locationMethod"]');
    const manualCoordsDiv = document.getElementById('manualCoords');
    if (!locationRadios.length || !manualCoordsDiv) return;

    const applyLocationMethod = (method) => {
        manualCoordsDiv.style.display = method === 'manual' ? 'flex' : 'none';
    };
    applyLocationMethod(STATE.locationMethod || 'geo');

    locationRadios.forEach(radio => {
        radio.addEventListener('change', e => {
            const value = e.target.value === 'manual' ? 'manual' : 'geo';
            STATE.locationMethod = value;
            saveSettings();
            applyLocationMethod(value);
        });
    });
}

// Affichage principal de la timeline à partir de STATE.currentRoute
export function displayTimeline(currentIdx = null) {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    // ✅ DEBUG
    console.log(`[displayTimeline] STATE.currentRoute.length = ${STATE.currentRoute?.length || 0}`);

    // Si pas de route ou pas d'heure de départ, on vide juste
    if (!STATE.currentRoute || !STATE.currentRoute.length || !STATE.departureTime) {
        timeline.innerHTML = '';
        return;
    }

    // Header
    timeline.innerHTML = '';
    const headerDiv = document.createElement('div');
    headerDiv.className = 'station header';
    headerDiv.innerHTML = `<span>TIME</span><span>WAYPOINT</span><span>DELAY</span>`;
    timeline.appendChild(headerDiv);

    // On part de l'heure de départ
    let currentDate = timeStringToDate(STATE.departureTime);

    STATE.currentRoute.forEach((point, idx) => {
        const stationDiv = document.createElement('div');
        stationDiv.className = 'station';

        // Pour le point idx, l'heure d'arrivée = départ + somme des durées des segments 0..(idx-1)
        // Autrement dit : on ajoute la durée du segment PRECEDENT (route[idx-1]) pour arriver à idx
        if (idx > 0) {
            const prevPoint = STATE.currentRoute[idx - 1];
            const durSec = Number(
                prevPoint.durationEffective ??
                prevPoint.baseDurationToNext ??
                0
            );
            currentDate = new Date(currentDate.getTime() + durSec * 1000);
        }
        const arrivalTimeStr = formatTime(currentDate);

        // Nom du point (gras si gare/stop)
        const isStop = !!point.isStop;
        const nameHtml = isStop ? `<strong>${point.name}</strong>` : point.name;

        // Retard affiché
        const isNextPoint = currentIdx != null && idx === currentIdx + 1;
        let delayText = '';
        if (STATE.passedPoints && Object.prototype.hasOwnProperty.call(STATE.passedPoints, point.id)) {
            delayText = formatDelayMs(STATE.passedPoints[point.id]);
        } else if (isNextPoint && typeof STATE.currentDelay === 'number') {
            delayText = formatDelayMs(STATE.currentDelay);
        }

        const timeSpan = isNextPoint && delayText
            ? `<span>${arrivalTimeStr} <span class="delay-inline">${delayText}</span></span>`
            : `<span>${arrivalTimeStr}</span>`;

        stationDiv.innerHTML = `
            ${timeSpan}
            <span>${nameHtml}</span>
            <span class="delay">${isNextPoint ? '' : delayText}</span>
        `;

        // Styling de la station courante / passée
        if (currentIdx !== null && idx === currentIdx) {
            stationDiv.classList.add('current-station');
        } else if (currentIdx !== null && idx < currentIdx) {
            stationDiv.classList.add('passed');
        }

        timeline.appendChild(stationDiv);
    });
}

export function updateInfo(msg) {
    const infoEl = document.getElementById('info');
    if (infoEl) infoEl.innerHTML = msg;
}

// -- FONCTIONS WIDGET --

export function updateTrackingWidget(lastPassedPoint, nextPoint, lastPointDistanceKm, nextPointDistanceKm) {
    const lastLineEl = document.getElementById('last-line');
    const nextLineEl = document.getElementById('next-line');
    const currentTimeEl = document.getElementById('current-time');

    if (lastLineEl) {
        lastLineEl.innerHTML = lastPassedPoint
            ? `<span class="label-last">Last :</span> <span class="point">${lastPassedPoint.name}</span> <span class="distance-inline">· ${lastPointDistanceKm.toFixed(2)} km</span>`
            : `<span class="label-last">Last :</span> <span class="distance-inline">—</span>`;
    }

    if (nextLineEl) {
        nextLineEl.innerHTML = nextPoint
            ? `<span class="label-next">Next :</span> <span class="point">${nextPoint.name}</span> <span class="distance-inline">· ${nextPointDistanceKm.toFixed(2)} km</span>`
            : `<span class="label-next">Next :</span> <span class="distance-inline">Route ended</span>`;
    }

    if (!currentTimeEl) return;

    const setStatus = (value, tone) => {
        currentTimeEl.innerHTML = `
            <span class="status-label">Statut</span>
            <span class="status-value">${value}</span>
        `;
        currentTimeEl.classList.toggle('red', tone === 'red');
        currentTimeEl.classList.toggle('green', tone === 'green');
    };

    if (!nextPoint || typeof STATE.currentDelay !== 'number') {
        currentTimeEl.textContent = '';
        currentTimeEl.classList.remove('red', 'green');
        return;
    }

    if (STATE.currentDelay > 30_000) {
        const minutes = Math.max(1, Math.ceil(STATE.currentDelay / 60000));
        setStatus(`Delay ${minutes} min`, 'red');
    } else {
        setStatus('On Time', 'green');
    }
}

// -- LANDSCAPE HUD --

let _hudLastActiveIdx = null;
let _hudLastRouteKey = null;
let _hudScrollAnimId = null;

function formatHudDelay(delayMs) {
    if (typeof delayMs !== 'number') return '';
    const absMin = Math.floor(Math.abs(delayMs) / 60_000);
    if (absMin < 1) return '';
    const sign = delayMs > 0 ? '+' : '-';
    if (absMin >= 60) {
        const h = Math.floor(absMin / 60);
        const m = absMin % 60;
        return `${sign}${h}h${m > 0 ? m + 'm' : ''}`;
    }
    return `${sign}${absMin}min`;
}

export function updateLandscapeHUD(currentIdx, speed, currentDelay, userLat, userLon, speedReliable = true) {
    if (!window.matchMedia('(orientation: landscape)').matches) return;

    // --- Dashboard ---
    const speedEl = document.getElementById('hud-speed');
    const etaEl = document.getElementById('hud-eta');
    const delayEl = document.getElementById('hud-delay');

    if (speedEl) {
        if (!speedReliable) {
            speedEl.style.setProperty('--speed-deg', '0deg');
            speedEl.innerHTML = `<span class="hud-speed-value">No GPS</span>`;
        } else {
            const displaySpeed = Math.round(speed);
            const arcSpeed = Math.min(displaySpeed, 320);
            const speedDeg = Math.round((arcSpeed / 320) * 240);
            speedEl.style.setProperty('--speed-deg', `${speedDeg}deg`);
            speedEl.innerHTML = `
                <span class="hud-speed-value">${displaySpeed}</span>
                <span class="hud-speed-unit">km/h</span>
            `;
        }
    }

    const graphCanvas = document.getElementById('hud-speed-graph');
    if (graphCanvas) {
        const ctx = graphCanvas.getContext('2d');
        const w = graphCanvas.width;
        const h = graphCanvas.height;
        const history = STATE.speedHistory || [];
        const maxSpeed = Math.max(...(history.slice(Math.max(0, history.length - 1200))), 1);

        ctx.clearRect(0, 0, w, h);

        if (history.length >= 2) {
            const total = 1200;
            const startIdx = Math.max(0, history.length - total);
            const points = history.slice(startIdx);
            const n = points.length;

            const xScale = w / (n - 1);

            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const x = i * xScale;
                const y = h - (Math.min(points[i], maxSpeed) / maxSpeed) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            // Fermeture du path pour le remplissage
            ctx.lineTo((n - 1) * xScale, h);
            ctx.lineTo(0, h);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Ligne
            ctx.beginPath();
            ctx.lineJoin = 'round';
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            for (let i = 0; i < n; i++) {
                const x = i * xScale;
                const y = h - (Math.min(points[i], maxSpeed) / maxSpeed) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Marqueurs des points passés
            const nowTs = Date.now();
            for (const marker of (STATE.passedPointMarkers || [])) {
                const secsAgo = Math.round((nowTs - marker.ts) / 1000);
                const markerIdx = (history.length - 1 - secsAgo) - startIdx;
                if (markerIdx < 0 || markerIdx >= n) continue;
                const x = markerIdx * xScale;
                const y = h - (Math.min(points[markerIdx], maxSpeed) / maxSpeed) * h;

                // Trait vertical
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.lineWidth = 1;
                ctx.moveTo(x, y);
                ctx.lineTo(x, h);
                ctx.stroke();

                // Point blanc
                ctx.beginPath();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    if (etaEl && STATE.currentRoute.length && STATE.departureTimestamp) {
        let totalSec = 0;
        for (let i = 0; i < STATE.currentRoute.length - 1; i++) {
            totalSec += Number(STATE.currentRoute[i].durationEffective ?? STATE.currentRoute[i].baseDurationToNext ?? 0);
        }
        const theoArrivalMs = STATE.departureTimestamp + totalSec * 1000;
        const beforeDeparture = Date.now() < STATE.departureTimestamp;
        const etaMs = beforeDeparture
            ? theoArrivalMs
            : theoArrivalMs + (typeof currentDelay === 'number' ? currentDelay : 0);
        const etaDate = new Date(etaMs);
        const hh = String(etaDate.getHours()).padStart(2, '0');
        const mm = String(etaDate.getMinutes()).padStart(2, '0');
        etaEl.innerHTML = `
            <span class="hud-eta-label">ETA</span>
            <span class="hud-eta-time">${hh}:${mm}</span>
        `;
    }

    if (delayEl) {
        const delayMinutes = Math.floor(Math.abs(currentDelay) / 60_000);
        let label;
        if (currentDelay > 60_000) {
            label = `+ ${delayMinutes} min LATE`;
            delayEl.className = 'late';
        } else if (currentDelay < -180_000) {
            label = `- ${delayMinutes} min EARLY`;
            delayEl.className = 'early';
        } else {
            label = 'ON TIME';
            delayEl.className = '';
        }
        delayEl.textContent = label;
    }

    // --- Carousel ---
    const trackPoints = document.getElementById('hud-track-points');
    if (!trackPoints || !STATE.currentRoute.length) return;

    const carousel = trackPoints.closest('.hud-carousel') || trackPoints.parentElement;
    const carouselHeight = carousel ? carousel.clientHeight : window.innerHeight;

    const routeKey = STATE.selectedPatternId || String(STATE.currentRoute.length);
    const routeChanged = routeKey !== _hudLastRouteKey;
    const idxChanged = currentIdx !== _hudLastActiveIdx;

    if (!routeChanged && idxChanged) {
        _hudLastActiveIdx = currentIdx;

        // Mesure la position finale via un clone hors-écran (sans transitions)
        // pour connaître la destination exacte avant de lancer l'animation de scroll
        const clone = trackPoints.cloneNode(true);
        // Préserver le paddingTop/Bottom (définis inline par JS) — cssText les écraserait
        const padTop = trackPoints.style.paddingTop;
        const padBot = trackPoints.style.paddingBottom;
        clone.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:${trackPoints.offsetWidth}px;top:-9999px;left:-9999px;padding-top:${padTop};padding-bottom:${padBot}`;
        clone.querySelectorAll('.hud-point, .hud-point-dot, .hud-point-name, .hud-point-time, .hud-point-distance').forEach(el => {
            el.style.transition = 'none';
        });
        clone.querySelectorAll('.hud-point[data-idx]').forEach(div => {
            const i = parseInt(div.dataset.idx, 10);
            let cls = 'hud-point';
            if      (i === currentIdx)     cls += ' active';
            else if (i === currentIdx + 1) cls += ' next';
            else if (i === currentIdx - 1) cls += ' passed-1';
            else if (i === currentIdx + 2) cls += ' future-1';
            else if (i < currentIdx)       cls += ' passed';
            else                           cls += ' future';
            if (STATE.currentRoute[i] && STATE.currentRoute[i].isStop) cls += ' stop';
            div.className = cls;
        });
        document.body.appendChild(clone);
        const cloneActive = clone.querySelector('.hud-point.active');
        const scrollTarget = cloneActive
            ? Math.max(0, cloneActive.offsetTop + cloneActive.offsetHeight / 2 - carouselHeight * 0.35)
            : carousel.scrollTop;
        document.body.removeChild(clone);

        // Mise à jour des classes sur les vrais éléments (CSS transitions démarrent)
        trackPoints.querySelectorAll('.hud-point[data-idx]').forEach(div => {
            const i = parseInt(div.dataset.idx, 10);
            let cls = 'hud-point';
            if      (i === currentIdx)     cls += ' active';
            else if (i === currentIdx + 1) cls += ' next';
            else if (i === currentIdx - 1) cls += ' passed-1';
            else if (i === currentIdx + 2) cls += ' future-1';
            else if (i < currentIdx)       cls += ' passed';
            else                           cls += ' future';
            if (STATE.currentRoute[i] && STATE.currentRoute[i].isStop) cls += ' stop';
            div.className = cls;

            // Badge de retard pour le point nouvellement actif
            if (i <= currentIdx && STATE.passedPoints && Object.prototype.hasOwnProperty.call(STATE.passedPoints, STATE.currentRoute[i].id)) {
                const timeEl = div.querySelector('.hud-point-time');
                if (timeEl && !timeEl.querySelector('.hud-point-delay')) {
                    const delayStr = formatHudDelay(STATE.passedPoints[STATE.currentRoute[i].id]);
                    if (delayStr) {
                        const cls2 = STATE.passedPoints[STATE.currentRoute[i].id] < 0 ? 'hud-point-delay early' : 'hud-point-delay';
                        const badge = document.createElement('span');
                        badge.className = cls2;
                        badge.textContent = delayStr;
                        timeEl.appendChild(badge);
                    }
                }
            }
        });

        // Animation de scroll de l'ancienne position vers la nouvelle, avec easing
        if (_hudScrollAnimId) cancelAnimationFrame(_hudScrollAnimId);
        const scrollStart = carousel.scrollTop;
        const scrollDelta = scrollTarget - scrollStart;
        const animStart = performance.now();
        const SCROLL_DURATION = 750;
        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }
        function animateScroll(now) {
            const elapsed = Math.min(now - animStart, SCROLL_DURATION);
            carousel.scrollTop = scrollStart + scrollDelta * easeInOutCubic(elapsed / SCROLL_DURATION);
            if (elapsed < SCROLL_DURATION) {
                _hudScrollAnimId = requestAnimationFrame(animateScroll);
            } else {
                _hudScrollAnimId = null;
            }
        }
        _hudScrollAnimId = requestAnimationFrame(animateScroll);
    }

    if (routeChanged) {
        _hudLastActiveIdx = currentIdx;
        _hudLastRouteKey = routeKey;

        // Padding allows first/last points to scroll to their target position
        trackPoints.style.paddingTop = `${carouselHeight * 0.35}px`;
        trackPoints.style.paddingBottom = `${carouselHeight * 0.65}px`;

        trackPoints.innerHTML = '';

        // Pré-calcul des heures d'arrivée théoriques pour tous les points
        const arrivalTimes = [];
        let cumMs = STATE.departureTimestamp || 0;
        arrivalTimes.push(cumMs);
        for (let i = 0; i < STATE.currentRoute.length - 1; i++) {
            cumMs += Number(STATE.currentRoute[i].durationEffective ?? STATE.currentRoute[i].baseDurationToNext ?? 0) * 1000;
            arrivalTimes.push(cumMs);
        }

        for (let i = 0; i < STATE.currentRoute.length; i++) {
            const point = STATE.currentRoute[i];

            // Hiérarchie des classes : active > next > passed-1/future-1 > passed/future
            let cls;
            if      (i === currentIdx)     cls = 'hud-point active';
            else if (i === currentIdx + 1) cls = 'hud-point next';
            else if (i === currentIdx - 1) cls = 'hud-point passed-1';
            else if (i === currentIdx + 2) cls = 'hud-point future-1';
            else if (i < currentIdx)       cls = 'hud-point passed';
            else                           cls = 'hud-point future';

            if (point.isStop) cls += ' stop';

            const div = document.createElement('div');
            div.className = cls;
            div.dataset.idx = i;

            const arrivalDate = arrivalTimes[i] ? new Date(arrivalTimes[i]) : null;
            const timeStr = arrivalDate
                ? `${String(arrivalDate.getHours()).padStart(2, '0')}:${String(arrivalDate.getMinutes()).padStart(2, '0')}`
                : '';

            // Delay badge for passed points and active point
            let delayHtml = '';
            if (i <= currentIdx && STATE.passedPoints && Object.prototype.hasOwnProperty.call(STATE.passedPoints, point.id)) {
                const delayStr = formatHudDelay(STATE.passedPoints[point.id]);
                if (delayStr) {
                    const cls2 = STATE.passedPoints[point.id] < 0 ? 'hud-point-delay early' : 'hud-point-delay';
                    delayHtml = `<span class="${cls2}">${delayStr}</span>`;
                }
            }

            div.innerHTML = `
                <div class="hud-point-dot"></div>
                <div class="hud-point-info">
                    <div class="hud-point-name">${point.name}</div>
                    ${timeStr ? `<div class="hud-point-time">${timeStr}${delayHtml}</div>` : ''}
                    <div class="hud-point-distance"></div>
                </div>
            `;

            trackPoints.appendChild(div);
        }

        // Defer layout-sensitive measurements to next frame
        requestAnimationFrame(() => {
            // Set bordeaux line bounds between first and last point centers
            const allHudPoints = trackPoints.querySelectorAll('.hud-point');
            if (allHudPoints.length >= 1) {
                const firstPt = allHudPoints[0];
                const lastPt = allHudPoints[allHudPoints.length - 1];
                trackPoints.style.setProperty('--line-top', `${firstPt.offsetTop + firstPt.offsetHeight / 2}px`);
                trackPoints.style.setProperty('--line-bottom', `${trackPoints.scrollHeight - lastPt.offsetTop - lastPt.offsetHeight / 2}px`);
            }

            // Snap carousel to active point at 35% from top
            const activePoint = trackPoints.querySelector('.hud-point.active');
            if (activePoint && carousel) {
                carousel.scrollTop = Math.max(0, activePoint.offsetTop + activePoint.offsetHeight / 2 - carouselHeight * 0.35);
            }
        });
    }

    // Every call: correct scroll position in case of drift (skip during transition animation)
    if (!_hudScrollAnimId) {
        requestAnimationFrame(() => {
            if (!carousel) return;
            const activePoint = trackPoints.querySelector('.hud-point.active');
            if (!activePoint) return;
            const scrollTarget = Math.max(0, activePoint.offsetTop + activePoint.offsetHeight / 2 - carouselHeight * 0.35);
            if (Math.abs(carousel.scrollTop - scrollTarget) > 3) {
                carousel.scrollTo({ top: scrollTarget, behavior: 'smooth' });
            }
        });
    }

    // Mise à jour des distances en temps réel (à chaque appel GPS, même sans rebuild)
    const hasCoords = typeof userLat === 'number' && typeof userLon === 'number';
    if (hasCoords) {
        trackPoints.querySelectorAll('.hud-point[data-idx]').forEach(div => {
            const i = parseInt(div.dataset.idx, 10);
            const point = STATE.currentRoute[i];
            if (!point || typeof point.lat !== 'number' || typeof point.lon !== 'number') return;
            const distEl = div.querySelector('.hud-point-distance');
            if (!distEl) return;
            const dist = haversineDistance(userLat, userLon, point.lat, point.lon);
            const arrow = i <= currentIdx ? '↓' : '↑';
            distEl.textContent = `${arrow} ${dist.toFixed(1)} km`;
        });
    }
}

// -- UTILITAIRES LOCAUX --

function formatDelayMs(delayMs) {
    if (typeof delayMs !== 'number') return '';

    // On n'affiche pas les retards négatifs (avance) ni les retards inférieurs à 1 minute
    if (delayMs < 60000) return '';

    const totalMinutes = Math.floor(delayMs / 60000);
    if (totalMinutes >= 60) {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return m > 0 ? `+${h}h${m}min` : `+${h}h`;
    }
    return `+${totalMinutes}min`;
}
