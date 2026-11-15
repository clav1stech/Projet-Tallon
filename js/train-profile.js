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
