// sw.js — Service worker : cache hors-ligne pour usage en TGV (réseau instable).
//
// Stratégie "stale-while-revalidate" : toute ressource déjà en cache est servie
// immédiatement (zéro latence même sans réseau), puis rafraîchie en arrière-plan
// pour la prochaine visite. Incrémenter CACHE_VERSION pour forcer une purge.

const CACHE_VERSION = 'tallon-v16';

// Coquille applicative pré-cachée à l'installation.
const PRECACHE_URLS = [
    './',
    './index.html',
    './car.html',
    './car-points-editor.html',
    './css/styles.css',
    './js/app.js',
    './js/functions.js',
    './js/geo.js',
    './js/state.js',
    './js/tracking.js',
    './js/ui.js',
    './js/utils.js',
    './js/routes-config.js',
    './js/fakeGeoSim.js',
    './js/csv.js',
    './js/linearref.js',
    './js/position-engine.js',
    './js/car-config.js',
    './js/car-route.js',
    './js/car-app.js',
    './js/car-ui.js',
    './js/car-waypoint-overrides.js',
    './js/car-points-editor.js',
    './data/masterRoutes.normalized.json',
    './data/servicePatterns.json',
    // Datasets PK/PR : descripteurs + CSV générés dans data/csv/ (hors-ligne
    // sur l'A40 aussi). Ne JAMAIS précacher data/raw/ (fichiers sources ~175 Mo).
    './data/datasets/rail-pk.json',
    './data/datasets/a40-trace.json',
    './data/datasets/a406-trace.json',
    './data/datasets/d1212-trace.json',
    './data/csv/rail_pk.csv',
    './data/csv/road_trace.csv',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Jamais mises en cache : APIs temps réel (position train).
const NETWORK_ONLY = [
    'wifi.sncf'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            // addAll échoue en bloc si UNE ressource échoue ; en TGV on préfère
            // cacher tout ce qui passe, ressource par ressource.
            .then((cache) => Promise.allSettled(
                PRECACHE_URLS.map((url) => cache.add(url))
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;
    if (NETWORK_ONLY.some((host) => url.hostname.includes(host))) return;
    // Ne gérer que http(s) (exclut les schémas d'extensions, etc.)
    if (!url.protocol.startsWith('http')) return;

    event.respondWith(staleWhileRevalidate(event.request));
});

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request, { ignoreSearch: false });

    const networkFetch = fetch(request)
        .then((response) => {
            // Cacher les réponses valides (y compris opaques pour le CDN font-awesome)
            if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        // Réponse instantanée depuis le cache ; le réseau met à jour en fond.
        networkFetch.catch(() => {});
        return cached;
    }

    const network = await networkFetch;
    if (network) return network;

    // Hors-ligne et pas en cache : pour une navigation, retomber sur l'index.
    if (request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
    }
    return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
}
