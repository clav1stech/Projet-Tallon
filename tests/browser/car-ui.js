// Harnais navigateur du mode voiture : accueil, cycle de session, cockpit,
// tunnels, carrousel, orientations, puis passage voiture → train → voiture.
const frame = document.getElementById('frame');
const status = document.getElementById('status');
const output = document.getElementById('result');
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, label = 'Chargement') => { for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(50); } throw new Error(`${label} expiré`); };
let logs = [];
const assert = (value, text) => { logs.push(`${value ? '✓' : '✗'} ${text}`); output.textContent = logs.join('\n'); if (!value) throw new Error(text); };
const base = new URL('../../', location.href).href;
const source = await (await fetch(`${base}car.html`)).text();
// Préférences isolées, horloge et géolocalisation pilotées par le test.
const injected = `<base href="${base}"><script>
const preferences = new Map(); Object.defineProperty(window, 'localStorage', {value: {getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value))}});
window.__preferences = preferences;
window.__now = new Date(2026,10,15,9,58).getTime(); Date.now=()=>window.__now;
window.__watches=0;window.__clears=0;
navigator.geolocation.watchPosition=callback=>{window.__watches++;window.__fix=callback;return 7};
navigator.geolocation.clearWatch=()=>{window.__clears++};
window.setInterval=callback=>{window.__tick=callback;return 1};window.clearInterval=()=>{window.__tick=null};
// Images cadencées par minuterie : un onglet en arrière-plan ou sans affichage ne sert pas requestAnimationFrame.
window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;
window.addEventListener('error',event=>parent.postMessage({testError:event.message},'*'));
</script><script type="module">
import {STATE} from '${base}js/state.js';import {buildCumulativeDistances} from '${base}js/geo.js';import {CAR_TRACKING_CONFIG} from '${base}js/car-config.js';
window.__modules={STATE,buildCumulativeDistances,config:CAR_TRACKING_CONFIG};
</script>`;
frame.srcdoc = source.replace('<head>', `<head>${injected}`).replace("if ('serviceWorker' in navigator", "if (false && 'serviceWorker' in navigator");
await waitFor(() => frame.contentWindow.__modules && frame.contentDocument.getElementById('start-btn') && !frame.contentDocument.getElementById('start-btn').disabled, 'Itinéraire');
const win = frame.contentWindow, doc = frame.contentDocument;
const { STATE, buildCumulativeDistances, config } = win.__modules;
const $ = id => doc.getElementById(id);
const sizes = [[320, 568], [568, 320], [375, 667], [667, 375], [393, 852], [852, 393], [440, 956], [956, 440], [834, 1194], [1194, 834], [1440, 900]];
const resize = async (w, h) => { frame.width = w; frame.height = h; await pause(); win.dispatchEvent(new win.Event('resize')); await pause(); };
const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= win.innerWidth + 1 && r.top >= 0 && r.bottom <= win.innerHeight + 1; };
// Position le long de la route suivie, à un km-route donné.
const at = km => {
    const route = STATE.currentRoute, cum = buildCumulativeDistances(route);
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < km) i++;
    const ratio = Math.max(0, Math.min(1, (km - cum[i]) / (cum[i + 1] - cum[i] || 1)));
    return { latitude: route[i].lat + ratio * (route[i + 1].lat - route[i].lat), longitude: route[i].lon + ratio * (route[i + 1].lon - route[i].lon) };
};
// Un fix GPS mesuré : 25 m/s natifs = 90 km/h.
const fix = (km, elapsedMs = 1000) => { win.__now += elapsedMs; win.__fix({ coords: { ...at(km), accuracy: 8, speed: 25 }, timestamp: win.__now }); };
const silence = ms => { win.__now += ms; win.__tick(); };
const routeLengthKm = () => buildCumulativeDistances(STATE.currentRoute).at(-1);

async function run() {
    logs = [];
    try {
        // --- Accueil ---
        assert(!$('home-view').hidden && $('tracking-view').hidden, 'Première ouverture sur l’accueil');
        assert(doc.querySelector('link[href="css/train.css"]') && doc.querySelector('link[href="css/car.css"]'), 'Feuille commune et thème voiture chargés');
        assert($('origin-name').textContent === 'Mâcon' && $('destination-name').textContent === 'Combloux', 'Départ et destination affichés');
        assert(/^\d+ km$/.test($('route-meta').textContent), 'Distance totale affichée');
        const sectors = [...$('route-sectors').children].map(li => li.querySelector('span').textContent);
        assert(sectors.length >= 5 && sectors[0] === 'Mâconnais' && sectors.at(-1) === 'Mont-Blanc', 'Secteurs traversés dans le sens du trajet');
        assert(!$('home-view').textContent.includes('Péage') && !$('home-view').textContent.includes('Tunnel'), 'Aucun repère détaillé sur l’accueil');
        assert(!doc.querySelector('input[type="time"]') && !$('home-view').textContent.match(/arrivée \d|retard/i), 'Ni horaire ni retard');
        $('reverse-btn').click(); await waitFor(() => !$('start-btn').disabled, 'Itinéraire retour');
        assert($('origin-name').textContent === 'Combloux' && $('route-sectors').children[0].textContent.includes('Mont-Blanc'), 'Inversion du sens : extrémités et secteurs retournés');
        assert(win.__preferences.get('car.routeKey') === 'COMBLOUX_MACON', 'Itinéraire mémorisé sous une clé propre à la voiture');
        $('reverse-btn').click();
        assert($('origin-name').textContent === 'Mâcon' && !$('start-btn').disabled, 'Retour au sens initial sans rechargement');
        for (const [w, h] of sizes) {
            await resize(w, h);
            assert(doc.documentElement.scrollWidth <= w + 1, `Accueil sans débordement ${w}×${h}`);
            assert(visible($('start-btn')), `Action principale accessible ${w}×${h}`);
            assert($('mode-switch').getBoundingClientRect().height >= 44, `Changement de mode : cible de 44 px ${w}×${h}`);
        }

        // --- Lancement ---
        $('start-btn').click();
        assert(!$('tracking-view').hidden && win.__watches === 1, 'Lancer ouvre le cockpit, une seule acquisition');
        assert($('progress-label').textContent === 'Position en attente' && $('speed-value').textContent === '—', 'Avant le premier fix : aucune position affichée');
        const tunnel = win.FAKE_GPS_SIGNAL_GAPS[0];
        fix(tunnel.startKm - 1.2); fix(tunnel.startKm - 1.175);
        assert($('speed-value').textContent === '90', 'Vitesse native 25 m/s → 90 km/h');
        assert($('sector-name').textContent === 'Bugey', 'Secteur géographique courant');
        assert($('next-line').textContent.includes(tunnel.name) && $('next-line').textContent.includes('km'), 'Prochain repère et distance, distincts du secteur');
        assert(/ %$/.test($('progress-chip').textContent) && $('remaining-text').textContent.includes('km restants'), 'Progression et distance restante');
        assert($('location-status').textContent.includes('Signal actif') && $('location-status').dataset.signal === 'ok', 'État du signal GPS');
        assert(!$('tracking-view').textContent.match(/ETA|arrivée prévue|retard|\d\d:\d\d/i), 'Cockpit sans heure ni retard');
        assert($('train-points').querySelectorAll('.train-point').length > 20 && doc.querySelector('.train-point.next .point-name').textContent.includes(tunnel.name), 'Carrousel routier : prochain repère en tête');
        assert(doc.querySelectorAll('.train-point.stop').length >= 4 && doc.querySelectorAll('.train-point .wp-icon').length > 20, 'Typologie routière : péages mis en avant, icônes par type');
        assert(!doc.querySelector('.train-point time') && !$('train-points').textContent.match(/\d\d:\d\d/), 'Aucun horaire sur les repères');
        assert(!doc.querySelector('.train-cursor').hidden, 'Tête de lecture positionnée');
        const node = $('train-points').children[0];
        for (const [w, h] of sizes) {
            await resize(w, h);
            assert(doc.documentElement.scrollWidth <= w + 1, `Cockpit sans débordement ${w}×${h}`);
            for (const id of ['settings-btn', 'train-carousel', 'speed-gauge', 'sector-name', 'next-line', 'speed-profile', 'location-status']) assert(visible($(id)), `${id} visible ${w}×${h}`);
            assert($('train-points').children[0] === node, `Carrousel conservé après rotation ${w}×${h}`);
            const next = doc.querySelector('.train-point.next').getBoundingClientRect(), box = $('train-carousel').getBoundingClientRect();
            assert(next.top + next.height / 2 > box.top && next.top + next.height / 2 < box.bottom, `Prochain repère centré ${w}×${h}`);
        }
        await resize(393, 852);
        assert(visible($('km-done')) && visible($('speed-max')), 'Portrait : compteurs de distance et de vitesse visibles');

        // --- Carrousel : consultation libre ---
        $('train-carousel').dispatchEvent(new win.Event('wheel'));
        assert(!$('recenter-btn').hidden, 'Défilement manuel : suivi automatique suspendu');
        $('train-carousel').scrollTop = 0; fix(tunnel.startKm - 1.15);
        assert($('train-carousel').scrollTop === 0, 'Un fix ne reprend pas la main pendant la consultation');
        $('recenter-btn').click();
        assert($('recenter-btn').hidden, 'Recentrage sur la position courante');

        // --- Réglages pendant la session ---
        $('settings-btn').click();
        assert(!$('home-view').hidden && !$('session-status').hidden && $('start-btn').dataset.mode === 'resume', 'Réglages : retour à l’accueil, suivi en cours');
        fix(tunnel.startKm - 1.1);
        assert(win.__watches === 1 && win.__clears === 0, 'Réglages : acquisition GPS ni arrêtée ni recréée');
        $('start-btn').click();
        assert($('speed-value').textContent === '90' && $('train-points').children[0] === node, 'Reprise : cockpit à jour, sans réinitialisation');
        $('settings-btn').click(); $('reverse-btn').click();
        assert($('start-btn').dataset.mode === 'apply' && !$('secondary-btn').hidden, 'Itinéraire provisoire : à appliquer ou annuler');
        $('secondary-btn').click();
        assert($('origin-name').textContent === 'Mâcon' && $('start-btn').dataset.mode === 'resume', 'Annulation : itinéraire suivi rétabli');
        $('start-btn').click();

        // --- Tunnel déclaré : progression estimée ---
        fix(tunnel.startKm - 0.06); fix(tunnel.startKm - 0.03);
        silence(config.gpsLostAfterMs + 500);
        assert($('speed-value').querySelector('img') && $('speed-unit').textContent.includes('ESTIMÉ'), 'Tunnel : image dédiée, vitesse non présentée comme mesurée');
        assert($('tracking-view').hasAttribute('data-estimated') && $('location-status').textContent.includes('estimée') && $('progress-label').textContent.includes('estimée'), 'Tunnel : position explicitement estimée');
        const image = $('speed-value').querySelector('img'); const before = parseFloat($('km-done').textContent.replace(',', '.'));
        silence(20_000);
        assert($('speed-value').querySelector('img') === image, 'Tunnel : image stable entre deux rendus');
        assert(parseFloat($('km-done').textContent.replace(',', '.')) > before, 'Tunnel : progression extrapolée à la vitesse d’entrée');
        assert(doc.querySelector('.train-point.next.on-structure') && parseFloat(doc.querySelector('.train-point.next .point-gauge span').style.width) > 0 && doc.querySelector('.train-point.next .point-detail').textContent.startsWith('Fin dans'), 'Ouvrage : jauge de franchissement et distance jusqu’à sa fin');
        fix(tunnel.endKm + 0.05, 115_000);
        assert(!$('tracking-view').hasAttribute('data-estimated') && $('speed-value').textContent === '90' && $('location-status').dataset.signal === 'ok', 'Sortie de tunnel : reprise sur le GPS mesuré');
        assert($('sector-name').textContent === 'Titans' && $('sector-name').classList.contains('swap'), 'Changement de secteur avec transition');

        // --- Perte de signal hors tunnel ---
        fix(tunnel.endKm + 0.075);
        const frozen = $('km-done').textContent;
        silence(config.gpsLostAfterMs + 500); silence(5000);
        // Hors tunnel déclaré ou viaduc jointif : la progression est suspendue.
        assert($('location-status').dataset.signal !== 'ok' && $('speed-value').textContent !== '90', 'Signal perdu : vitesse retirée, état signalé');
        assert($('tracking-view').hasAttribute('data-estimated'), 'Signal perdu : position marquée non mesurée');
        fix(tunnel.endKm + 0.3, 8000);
        assert($('location-status').dataset.signal === 'ok' && $('km-done').textContent !== frozen, 'Retour du signal : progression mesurée');

        // --- Détails ---
        $('details-btn').click();
        assert($('trip-details').open && $('waypoint-log').rows.length > 20 && $('details-stats').textContent.includes('Vitesse maximale'), 'Détails : compteurs et repères du parcours');
        assert($('waypoint-log').querySelector('tr.past') && $('waypoint-log').querySelector('tr.current'), 'Détails : repères franchis et prochain repère distingués');
        $('trip-details').querySelector('[data-profile-range="recent"]').click();
        assert($('details-profile').getAttribute('aria-label').includes('dernières minutes'), 'Profil : vue 15 min');
        $('details-profile').dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
        assert($('details-readout').textContent.includes('km/h mesurés'), 'Profil : lecture d’une mesure au clavier');
        $('trip-details').querySelector('[data-profile-range="trip"]').click();
        $('trip-details').querySelector('[data-close-dialog]').click();

        // --- Changement effectif d'itinéraire ---
        // La voiture ne bouge pas quand l'itinéraire change : le fix suivant
        // est pris au même endroit, vu depuis le trajet retour.
        const sameSpotKm = routeLengthKm() - (tunnel.endKm + 0.3);
        $('settings-btn').click(); $('reverse-btn').click(); $('start-btn').click();
        assert(!$('tracking-view').hidden && $('tracking-route').textContent === 'Combloux → Mâcon', 'Application : nouveau sens suivi');
        assert($('progress-label').textContent === 'Position en attente' && $('speed-max').textContent === '—', 'Changement d’itinéraire : progression et statistiques remises à zéro');
        assert(win.__watches === 1 && win.__clears === 0, 'Changement d’itinéraire : acquisition GPS conservée');
        fix(sameSpotKm, 2000);
        assert($('sector-name').textContent === 'Titans' && $('next-line').textContent.includes(' · ') && $('location-status').dataset.signal === 'ok', 'Sens retour : accrochage et repères du nouveau trajet');

        // --- Clôture ---
        $('settings-btn').click(); $('secondary-btn').click();
        assert($('end-session').open && win.__clears === 0, 'Clôture : confirmation préalable, acquisition maintenue');
        $('end-session').querySelector('[data-close-dialog]').click();
        $('secondary-btn').click(); $('confirm-end-btn').click();
        assert($('session-status').hidden && win.__clears === 1 && win.__tick === null && $('start-btn').dataset.mode === 'launch', 'Clôture confirmée : localisation arrêtée');
        assert($('origin-name').textContent === 'Combloux', 'Clôture : itinéraire choisi conservé');

        // --- Changement de mode pendant une session ---
        $('start-btn').click(); fix(60, 2000);
        $('settings-btn').click(); $('mode-switch').click();
        assert($('mode-switch-dialog').open && !$('session-status').hidden && win.__clears === 1, 'Changement de mode en session : confirmation, suivi maintenu');
        $('mode-switch-dialog').querySelector('[data-close-dialog]').click();
        assert(!$('session-status').hidden, 'Refus : la session continue');
        const historyLength = history.length;
        $('mode-switch').click(); $('confirm-mode-switch-btn').click();
        assert(win.__clears === 2 && $('session-status').hidden, 'Changement confirmé : session terminée, localisation arrêtée avant de quitter');

        // --- Pages réelles : voiture → train → voiture ---
        await waitFor(() => frame.contentWindow.location.pathname.endsWith('/index.html') && frame.contentDocument.getElementById('mode-switch')?.href, 'Page train');
        const train = frame.contentDocument, trainWin = frame.contentWindow;
        assert(train.body.classList.contains('train-app') && train.getElementById('home-title').textContent === 'Préparer le trajet', 'Arrivée sur l’accueil du train');
        assert(trainWin.localStorage.getItem('tallon.lastMode') === 'train', 'Dernier mode mémorisé : train');
        trainWin.localStorage.setItem('car.routeKey', 'COMBLOUX_MACON');
        const trainRoute = trainWin.localStorage.getItem('selectedMainRouteKey');
        train.getElementById('mode-switch').click();
        await waitFor(() => frame.contentWindow.location.pathname.endsWith('/car.html') && frame.contentDocument.getElementById('origin-name')?.textContent === 'Combloux', 'Page voiture');
        assert(frame.contentWindow.localStorage.getItem('tallon.lastMode') === 'car', 'Dernier mode mémorisé : voiture');
        assert(frame.contentWindow.localStorage.getItem('selectedMainRouteKey') === trainRoute, 'Réglages du train intacts après le passage par la voiture');
        assert(frame.contentDocument.getElementById('session-status').hidden, 'Aucune session reprise après un changement de mode');
        assert(history.length === historyLength, 'Changement de mode sans entrée d’historique : le geste retour ne ramène pas sur l’autre mode');

        status.textContent = `${logs.length} vérifications voiture réussies`;
        fetch(`./car-ui.html?result=success&checks=${logs.length}`);
    } catch (error) {
        status.textContent = `ÉCHEC : ${error.message}`; console.error(error);
        fetch(`./car-ui.html?result=failure&message=${encodeURIComponent(error.message)}`);
    }
}
document.getElementById('run').onclick = () => location.reload();
document.getElementById('size').onchange = event => resize(...event.target.value.split(',').map(Number));
window.addEventListener('message', event => { if (event.data.testError) { logs.push(`ERREUR JS : ${event.data.testError}`); output.textContent = logs.join('\n'); } });
await run();
