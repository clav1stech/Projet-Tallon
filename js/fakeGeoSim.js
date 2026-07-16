// js/fakeGeoSim.js
// Simulateur GPS de développement — INERTE par défaut, activé par l'URL.
// Aucune constante à éditer : impossible de committer la simulation "active".
//
// Activation :
//   index.html?fakegps            → simulation accélérée ×15 (défaut)
//   index.html?fakegps=30         → multiplicateur ×30 (1 = temps réel)
//
// Scénarios (paramètres combinables) :
//   &fakedelay=5                  → trajectoire décalée de 5 min (retard) ;
//                                   valeur négative = avance
//   &fakepace=0.9                 → train à 90 % de la vitesse théorique
//                                   (retard qui se creuse) ; > 1 = rattrapage
//   &fakestart=MACON_LOCHE        → démarre au droit d'un point (id ou nom)
//   &fakestart=40                 → démarre à 40 % du trajet
//
// Contrôles à chaud (console) :
//   window.fakeGps.pause() / .resume()
//   window.fakeGps.setSpeed(n)    → change le multiplicateur en cours de route
//   window.fakeGps.setPace(p)     → change l'allure (0.9 = retard qui se creuse)
//   window.fakeGps.seekTo(cible)  → saute à un point (id/nom) ou à N % du trajet
//   window.fakeGps.status()       → état courant de la simulation
//
// Pièges :
// - Le calcul de retard de l'app compare la position à l'horloge RÉELLE : à
//   multiplicateur ≠ 1, le retard affiché dérive mécaniquement (le train simulé
//   va N× plus vite que l'horloge murale). Pour valider computeCurrentDelay,
//   utiliser ?fakegps=1 avec l'heure de départ réglée à l'heure courante : le
//   retard affiché vaut alors fakedelay et évolue selon fakepace.
// - Un seekTo lointain pendant un suivi actif déclenche le garde-fou
//   anti-téléportation du moteur : ~3 fixes rejetés puis ré-ancrage
//   automatique — l'affichage suit après quelques secondes (c'est aussi un
//   bon moyen d'exercer ce chemin de récupération).
// - Le garde-fou unidirectionnel du moteur empêche l'index de segment de
//   reculer : un seekTo en arrière pendant un suivi actif ne fera pas reculer
//   l'affichage — relancer le suivi pour repartir en amont.

import { STATE } from './state.js';

const DEFAULT_MULTIPLIER = 15;
const LOG_INTERVAL_MS = 5000;

/**
 * Parse la query string et retourne la config de simulation, ou null si la
 * simulation est désactivée (paramètre absent ou multiplicateur invalide).
 * @param {string} search - window.location.search (ex: "?fakegps=30&fakedelay=5")
 * @returns {{ multiplier:number, pace:number, delayMinutes:number, start:string|null }|null}
 */
export function parseFakeGpsConfig(search) {
    let params;
    try {
        params = new URLSearchParams(search || '');
    } catch {
        return null;
    }
    if (!params.has('fakegps')) return null;

    const rawMultiplier = params.get('fakegps');
    const multiplier = rawMultiplier === '' ? DEFAULT_MULTIPLIER : Number(rawMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null;

    const rawDelay = Number(params.get('fakedelay'));
    const delayMinutes = Number.isFinite(rawDelay) ? rawDelay : 0;

    const rawPace = Number(params.get('fakepace'));
    const pace = Number.isFinite(rawPace) && rawPace > 0 ? rawPace : 1;

    const start = params.get('fakestart');
    return { multiplier, pace, delayMinutes, start: start === '' ? null : start };
}

// La durée du segment i → i+1 est stockée sur le point de départ (route[i]).
function segmentDurationMs(point) {
    return Number(point?.durationEffective ?? point?.baseDurationToNext ?? 0) * 1000;
}

/**
 * Durée théorique totale de la route, en ms (le dernier point ne porte pas de
 * durée vers un suivant).
 */
export function routeTotalDurationMs(route) {
    if (!route || route.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
        total += segmentDurationMs(route[i]);
    }
    return total;
}

/**
 * Position interpolée le long de la route pour un temps théorique écoulé donné.
 * @returns {{ latitude:number, longitude:number, segmentIndex:number, finished:boolean }|null}
 *          null si la route est vide.
 */
export function computeSimPosition(route, elapsedMs) {
    if (!route || route.length === 0) return null;

    let remaining = Math.max(0, elapsedMs);
    let segmentIndex = 0;

    while (segmentIndex < route.length - 1) {
        const duration = segmentDurationMs(route[segmentIndex]);
        if (remaining < duration) {
            const startPt = route[segmentIndex];
            const endPt = route[segmentIndex + 1];
            const progress = duration > 0 ? remaining / duration : 1;
            return {
                latitude: startPt.lat + (endPt.lat - startPt.lat) * progress,
                longitude: startPt.lon + (endPt.lon - startPt.lon) * progress,
                segmentIndex,
                finished: false
            };
        }
        remaining -= duration;
        segmentIndex++;
    }

    const lastPt = route[route.length - 1];
    return { latitude: lastPt.lat, longitude: lastPt.lon, segmentIndex, finished: true };
}

/**
 * Temps théorique (ms) nécessaire pour atteindre une cible sur la route.
 * @param {Array} route
 * @param {number|string} target - pourcentage du trajet (0–100, nombre ou
 *        chaîne numérique) ou id/nom de point (insensible à la casse).
 * @returns {number|null} null si la cible est introuvable ou la route vide.
 */
export function computeElapsedToTarget(route, target) {
    if (!route || route.length === 0 || target == null) return null;

    const asNumber = typeof target === 'number' ? target : Number(target);
    if (Number.isFinite(asNumber) && String(target).trim() !== '') {
        const percent = Math.max(0, Math.min(100, asNumber));
        return routeTotalDurationMs(route) * (percent / 100);
    }

    const needle = String(target).trim().toLowerCase();
    let elapsed = 0;
    for (let i = 0; i < route.length; i++) {
        const p = route[i];
        if (String(p.id ?? '').toLowerCase() === needle ||
            String(p.name ?? '').toLowerCase() === needle) {
            return elapsed;
        }
        if (i < route.length - 1) elapsed += segmentDurationMs(p);
    }
    return null;
}

// --- Runtime navigateur (inerte hors navigateur : tests Vitest en node) ---
(function () {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const config = parseFakeGpsConfig(window.location.search);
    if (!config) {
        console.log("⏹ Simulation GPS inactive — ajouter ?fakegps (ou ?fakegps=N) à l'URL pour l'activer.");
        return;
    }

    console.log(
        `🚀 Simulation GPS ACTIVE : ×${config.multiplier}, allure ${config.pace}, ` +
        `retard initial ${config.delayMinutes} min${config.start != null ? `, départ à "${config.start}"` : ''}.`
    );
    if (config.multiplier !== 1 && (config.delayMinutes !== 0 || config.pace !== 1)) {
        console.info(
            '💡 Le retard affiché n\'est fidèle qu\'à ?fakegps=1 (le moteur compare à l\'horloge réelle) — ' +
            'le multiplicateur accéléré sert à vérifier progression/timeline/HUD.'
        );
    }

    let multiplier = config.multiplier;
    let pace = config.pace;
    const delayMs = config.delayMinutes * 60000;

    // Horloge interne : temps théorique accumulé (déjà multiplié et mis à
    // l'allure). La position lue est simElapsedMs - delayMs (clampé ≥ 0), donc
    // le décalage de retard/avance est constant sur tout le trajet.
    let simElapsedMs = 0;
    let lastRealTs = Date.now();
    let paused = false;
    let pendingStart = config.start;
    let lastLogTs = 0;

    function advanceClock() {
        const now = Date.now();
        if (!paused) simElapsedMs += (now - lastRealTs) * multiplier * pace;
        lastRealTs = now;
    }

    function seekTo(target) {
        const elapsed = computeElapsedToTarget(STATE.currentRoute, target);
        if (elapsed == null) {
            console.warn(`[FAKE GPS] Cible de seek introuvable sur la route courante : "${target}"`);
            return false;
        }
        // + delayMs : on atterrit exactement sur la cible, le décalage de
        // retard s'applique à partir de là.
        simElapsedMs = elapsed + delayMs;
        lastRealTs = Date.now();
        console.log(`[FAKE GPS] Seek → "${target}" (${(elapsed / 60000).toFixed(1)} min théoriques).`);
        return true;
    }

    // Appelée par app.js / car-app.js au démarrage du suivi.
    function resetFakeGpsStartTime() {
        simElapsedMs = 0;
        lastRealTs = Date.now();
        pendingStart = config.start;
        console.log('⏱ Horloge de simulation réinitialisée.');
    }

    window.resetFakeGpsStartTime = resetFakeGpsStartTime;
    window.FAKE_GPS_SPEED_MULTIPLIER = multiplier;
    window.fakeGps = {
        pause() { advanceClock(); paused = true; console.log('⏸ Simulation en pause.'); },
        resume() { lastRealTs = Date.now(); paused = false; console.log('▶️ Simulation reprise.'); },
        setSpeed(n) {
            const v = Number(n);
            if (!Number.isFinite(v) || v <= 0) { console.warn('[FAKE GPS] Multiplicateur invalide.'); return; }
            advanceClock();
            multiplier = v;
            window.FAKE_GPS_SPEED_MULTIPLIER = v;
            console.log(`⚡ Multiplicateur → ×${v}`);
        },
        setPace(p) {
            const v = Number(p);
            if (!Number.isFinite(v) || v <= 0) { console.warn('[FAKE GPS] Allure invalide.'); return; }
            advanceClock();
            pace = v;
            console.log(`🚄 Allure → ${v}`);
        },
        seekTo,
        status() {
            const route = STATE.currentRoute || [];
            const posElapsed = Math.max(0, simElapsedMs - delayMs);
            const pos = computeSimPosition(route, posElapsed);
            const total = routeTotalDurationMs(route);
            console.log('[FAKE GPS] État :', {
                multiplier, pace, paused,
                delayMinutes: delayMs / 60000,
                elapsedTheoMin: +(posElapsed / 60000).toFixed(1),
                progressPercent: total > 0 ? +((posElapsed / total) * 100).toFixed(1) : null,
                segmentIndex: pos?.segmentIndex ?? null,
                finished: pos?.finished ?? null,
                routePoints: route.length
            });
        }
    };

    function getSimulatedPosition() {
        const route = STATE.currentRoute;
        if (!route || route.length === 0) {
            // Gare de Lyon : position plausible tant qu'aucune route n'est chargée.
            return { latitude: 48.84431, longitude: 2.37564, finished: false };
        }

        // fakestart ne peut s'appliquer qu'une fois la route chargée.
        if (pendingStart != null) {
            seekTo(pendingStart);
            pendingStart = null;
        }

        advanceClock();
        const pos = computeSimPosition(route, Math.max(0, simElapsedMs - delayMs));

        const now = Date.now();
        if (now - lastLogTs >= LOG_INTERVAL_MS) {
            lastLogTs = now;
            console.log(
                `[FAKE GPS] segment=${pos.segmentIndex}, elapsed=${((simElapsedMs - delayMs) / 1000).toFixed(0)}s, ` +
                `lat=${pos.latitude.toFixed(5)}, lon=${pos.longitude.toFixed(5)}${pos.finished ? ' (terminus)' : ''}${paused ? ' (pause)' : ''}`
            );
        }
        return pos;
    }

    function toGeoPosition(pos) {
        return {
            coords: {
                latitude: pos.latitude,
                longitude: pos.longitude,
                accuracy: 10,
                speed: 30,
                heading: null,
                altitude: null
            },
            timestamp: Date.now()
        };
    }

    const mockGeoLocation = {
        getCurrentPosition(success, _error, _options) {
            success(toGeoPosition(getSimulatedPosition()));
        },
        watchPosition(success, _error, _options) {
            success(toGeoPosition(getSimulatedPosition()));
            const intervalId = setInterval(() => {
                const p = getSimulatedPosition();
                success(toGeoPosition(p));
                if (p.finished) {
                    console.log('🏁 [FAKE GPS] Terminus (fin du trajet simulé).');
                    clearInterval(intervalId);
                }
            }, 1000);
            return intervalId;
        },
        clearWatch(id) {
            clearInterval(id);
        }
    };

    try {
        Object.defineProperty(navigator, 'geolocation', {
            value: mockGeoLocation,
            writable: true,
            configurable: true
        });
    } catch {
        try {
            navigator.geolocation = mockGeoLocation;
        } catch (e) {
            console.warn('⚠️ Impossible de surcharger navigator.geolocation dans cet environnement.', e);
        }
    }
})();
