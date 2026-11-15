// js/speed-profile-view.js
// Tracé et inspection du profil de vitesse, communs aux cockpits train et
// voiture. Le profil est un objet de données ({ samples, planned, stops,
// passages, totalKm, currentKm, maxKmh }) : le train y met ses moyennes
// horaires et ses passages, la voiture laisse ces listes vides.

import { buildProfileEnvelope, buildRecentWindow } from './train-profile.js';
import { kmText } from './app-shell.js';
import { formatTime } from './utils.js';

const clock = ts => Number.isFinite(ts) ? formatTime(new Date(ts)) : '––:––';
const dateTime = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * @param {object} options
 * @param {number} options.maxKmh - haut de l'échelle des vitesses
 * @param {number} options.maxColumns - plafond de colonnes du tracé « voyage »
 * @param {number} options.recentWindowMs - étendue de la vue récente
 * @param {string} options.accent - couleur de la mesure sur fond clair
 * @param {string} options.darkCursor - repère de position sur fond sombre
 */
export function createSpeedProfileView({ maxKmh, maxColumns, recentWindowMs, accent, darkCursor }) {
    let layouts = new WeakMap();

    /**
     * Le canvas est dimensionné en pixels physiques après chaque changement de surface.
     * @returns {{recent:boolean, points:number}|null} null si le canvas n'est pas affiché
     */
    function draw(canvas, profile, { dark = false, range = 'trip' } = {}) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const dpr = window.devicePixelRatio || 1;
        const width = rect.width, height = rect.height;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const detailed = height >= 90;
        const recent = detailed && range === 'recent';
        const left = detailed ? 30 : 1, right = 12, bottom = detailed ? 23 : 3, top = 8;
        const w = Math.max(1, width - left - right), h = Math.max(1, height - top - bottom);
        // L'échelle est celle des vitesses mesurables : une moyenne horaire
        // aberrante sur un segment court est écrêtée, elle n'écrase pas la courbe.
        const max = maxKmh;
        const y = v => top + h - Math.min(max, Math.max(0, v)) / max * h;
        const colors = dark
            ? { grid: '#ffffff20', text: '#c8c1c3', planned: '#c8c1c3', measured: '#fff', cursor: darkCursor, stop: '#ffffff30', late: '#ff8a73', onTime: '#6fd9a8' }
            : { grid: '#211d1e20', text: '#71676a', planned: '#8a777e', measured: accent, cursor: accent, stop: '#211d1e20', late: '#b8371f', onTime: '#1f7a52' };
        ctx.font = '11px system-ui';ctx.lineWidth = 1;
        ctx.strokeStyle = colors.grid;ctx.fillStyle = colors.text;
        if (detailed) {
            for (const v of [0, max / 2, max]) {
                ctx.beginPath();ctx.moveTo(left, y(v));ctx.lineTo(width - right, y(v));ctx.stroke();ctx.fillText(String(Math.round(v)), 0, y(v) + 4);
            }
        }
        if (recent) {
            const { fromTs, toTs, points } = buildRecentWindow(profile, recentWindowMs);
            const x = ts => left + (ts - fromTs) / recentWindowMs * w;
            ctx.fillText(`−${recentWindowMs / 60_000} min`, left, height - 4);
            ctx.textAlign = 'right';ctx.fillText(toTs == null ? 'Aucune mesure' : `Dernière mesure ${clock(toTs)}`, width - right, height - 4);ctx.textAlign = 'left';
            ctx.strokeStyle = colors.planned;ctx.setLineDash([4, 4]);ctx.beginPath();
            let previous = null;
            for (const point of points) {
                if (point.plannedKmh == null) { previous = null; continue; }
                if (!previous || point.gap) ctx.moveTo(x(point.ts), y(point.plannedKmh));
                else { ctx.lineTo(x(point.ts), y(previous.plannedKmh));ctx.lineTo(x(point.ts), y(point.plannedKmh)); }
                previous = point;
            }
            ctx.stroke();ctx.setLineDash([]);
            ctx.strokeStyle = colors.measured;ctx.lineWidth = 1.7;ctx.beginPath();
            points.forEach((point, index) => {
                if (index === 0 || point.gap) ctx.moveTo(x(point.ts), y(point.v));
                else ctx.lineTo(x(point.ts), y(point.v));
            });
            ctx.stroke();
            layouts.set(canvas, { recent: true, points, fromTs, toTs, left, width: w });
            return { recent: true, points: points.length };
        }
        const x = km => left + km / (profile.totalKm || 1) * w;
        if (detailed) {
            ctx.fillText('0', left, height - 4);ctx.textAlign = 'right';ctx.fillText(`${kmText(profile.totalKm)} km`, width - right, height - 4);ctx.textAlign = 'left';
        }
        ctx.strokeStyle = colors.planned;ctx.setLineDash([4, 4]);ctx.beginPath();
        for (const segment of profile.planned) { ctx.moveTo(x(segment.fromKm), y(segment.kmh));ctx.lineTo(x(segment.toKm), y(segment.kmh)); }
        ctx.stroke();ctx.setLineDash([]);
        const envelope = buildProfileEnvelope(profile, Math.min(maxColumns, w));
        layouts.set(canvas, { envelope, totalKm: profile.totalKm, left, width: w });
        ctx.strokeStyle = colors.measured;ctx.lineWidth = 1.7;ctx.beginPath();
        let previous = null;
        for (const bucket of envelope) {
            const points = [bucket.first, bucket.min, bucket.max, bucket.last].sort((a, b) => a.ts - b.ts);
            if (!previous || bucket.gap || previous.gap) ctx.moveTo(x(points[0].routeKm), y(points[0].v));
            else ctx.lineTo(x(points[0].routeKm), y(points[0].v));
            for (const point of points) ctx.lineTo(x(point.routeKm), y(point.v));
            previous = bucket;
        }
        ctx.stroke();
        if (profile.currentKm != null) {
            ctx.strokeStyle = colors.cursor;ctx.lineWidth = 1;ctx.beginPath();ctx.moveTo(x(profile.currentKm), top);ctx.lineTo(x(profile.currentKm), top + h);ctx.stroke();
        }
        if (detailed) {
            for (const stop of profile.stops) {
                ctx.strokeStyle = colors.stop;ctx.beginPath();ctx.moveTo(x(stop.km), top);ctx.lineTo(x(stop.km), top + h);ctx.stroke();
            }
            for (const passage of profile.passages) {
                ctx.fillStyle = passage.delayMs > 0 ? colors.late : colors.onTime;ctx.beginPath();ctx.arc(x(passage.km), top + h, 3, 0, Math.PI * 2);ctx.fill();
            }
        }
        return { recent: false, points: envelope.length };
    }

    /** Inspection au doigt, à la souris et au clavier, depuis les mesures du tracé. */
    function inspect(canvas, event, readout) {
        const layout = layouts.get(canvas);
        const items = layout?.recent ? layout.points : layout?.envelope;
        if (!items || !items.length) return;
        const rect = canvas.getBoundingClientRect();
        let index = null;
        let ratio = 0;
        if (event.type === 'keydown') {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            index = Math.max(0, Math.min(items.length - 1,
                event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Number(canvas.dataset.readIndex || 0) + (event.key === 'ArrowRight' ? 1 : -1)));
            canvas.dataset.readIndex = index;
        } else {
            ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - layout.left) / layout.width));
        }
        let sample = null;
        if (layout.recent) {
            if (index != null) sample = items[index];
            else {
                const targetTs = layout.fromTs + ratio * (layout.toTs - layout.fromTs);
                for (const point of items) {
                    if (!sample || Math.abs(point.ts - targetTs) < Math.abs(sample.ts - targetTs)) sample = point;
                }
            }
            readout.hidden = false;
            readout.textContent = `${dateTime(sample.ts)} · ${Math.round(sample.v)} km/h mesurés${sample.plannedKmh != null ? ` · moyenne théorique ${Math.round(sample.plannedKmh)} km/h` : ''}`;
            return;
        }
        const targetKm = index != null ? items[index].last.routeKm : ratio * layout.totalKm;
        for (const bucket of items) {
            for (const point of [bucket.first, bucket.min, bucket.max, bucket.last]) {
                if (!sample || Math.abs(point.routeKm - targetKm) < Math.abs(sample.routeKm - targetKm)) sample = point;
            }
        }
        readout.hidden = false;
        readout.textContent = `${kmText(sample.routeKm)} km · ${Math.round(sample.v)} km/h mesurés · ${dateTime(sample.ts)}`;
    }

    return { draw, inspect, reset() { layouts = new WeakMap(); } };
}
