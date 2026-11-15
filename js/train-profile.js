// Réduction graphique par colonne de pixels : garde les extrêmes mesurés de
// tout le voyage, sans fenêtre glissante ni coût de tracé lié à sa durée.
export function buildProfileEnvelope(profile, pixelWidth) {
    const width = Math.max(1, Math.floor(pixelWidth));
    const buckets = new Array(width);
    let pendingGap = false;
    for (const sample of profile.samples) {
        if (!sample.reliable || !sample.speedReliable || !Number.isFinite(sample.routeKm) || !Number.isFinite(sample.v)) {
            pendingGap = true;
            continue;
        }
        const x = Math.min(width - 1, Math.max(0, Math.floor(sample.routeKm / (profile.totalKm || 1) * (width - 1))));
        let bucket = buckets[x];
        if (!bucket) {
            bucket = buckets[x] = { x, first: sample, last: sample, min: sample, max: sample, gap: pendingGap };
        } else {
            bucket.last = sample;
            bucket.gap ||= pendingGap;
            if (sample.v < bucket.min.v) bucket.min = sample;
            if (sample.v > bucket.max.v) bucket.max = sample;
        }
        pendingGap = false;
    }
    return buckets.filter(Boolean);
}

// Fenêtre récente sur un axe temporel : les dernières mesures fiables, chacune
// avec la moyenne horaire théorique du segment où elle a été prise. Le coût
// dépend de la fenêtre, pas de la durée de la session.
export function buildRecentWindow(profile, windowMs) {
    const samples = profile.samples;
    if (!samples.length) return { fromTs: null, toTs: null, points: [] };
    const toTs = samples[samples.length - 1].ts;
    const fromTs = toTs - windowMs;
    let start = samples.length;
    while (start > 0 && samples[start - 1].ts >= fromTs) start--;
    const planned = profile.planned || [];
    const points = [];
    let segment = 0;
    let gap = true;
    for (let i = start; i < samples.length; i++) {
        const sample = samples[i];
        if (!sample.reliable || !sample.speedReliable || !Number.isFinite(sample.v)) {
            gap = true;
            continue;
        }
        let plannedKmh = null;
        if (Number.isFinite(sample.routeKm) && planned.length) {
            while (segment > 0 && planned[segment].fromKm > sample.routeKm) segment--;
            while (segment < planned.length - 1 && planned[segment].toKm < sample.routeKm) segment++;
            plannedKmh = planned[segment].kmh;
        }
        points.push({ ts: sample.ts, v: sample.v, routeKm: sample.routeKm ?? null, plannedKmh, gap });
        gap = false;
    }
    return { fromTs, toTs, points };
}
