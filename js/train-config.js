// js/train-config.js
// Réglages du mode train (session de tracking, navigation, horaires).
// Les tolérances du moteur géographique restent dans functions.js/tracking.js.

// Cadence de la boucle d'acquisition (un appel de localisation par tick).
export const TRACKING_TICK_MS = 1000;

export const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };

// Télémétrie WiFi SNCF. Certaines rames ne servent le routeur qu'en clair :
// essais dans cet ordre, le premier endpoint qui répond est conservé. Une page
// web HTTPS ne peut joindre que le premier (contenu mixte bloqué).
export const SNCF_GPS_URLS = ['https://wifi.sncf/router/api/train/gps', 'http://wifi.sncf/router/api/train/gps'];
export const SNCF_TIMEOUT_MS = 3000;
// Horodatage routeur figé depuis ce délai : position périmée, repli GPS.
// Inférieur à SIGNAL_LOSS_MIN_MS pour basculer avant l'alerte de perte.
export const SNCF_STALE_MS = 10_000;
// En repli GPS, intervalle entre deux tentatives de retour au WiFi SNCF.
export const SNCF_RETRY_MS = 15_000;
// Retard de la position servie par le routeur sur la position réelle du
// train : l'échantillon est avancé le long du trajet de la distance parcourue
// pendant ce délai à la vitesse mesurée.
export const SNCF_POSITION_LAG_MS = 2000;

// Fenêtre de positions servant à la vitesse médiane (≈ 10 s à 1 fix/s).
export const POSITION_WINDOW_SIZE = 10;

export const MAX_TRAIN_SPEED_KMH = 350;

// Avance plausible le long du trajet entre deux positions retenues : budget de
// distance alimenté à la vitesse mesurée majorée (ratio × v + marge), plafonnée
// à MAX_TRAIN_SPEED_KMH, et à ce plafond quand la vitesse n'est pas fiable ou
// sur un intervalle sans échantillon plus long que gapMs (app suspendue). Une
// position au-delà du budget (+ toleranceKm : bruit de projection, coordonnées
// de voie des ouvrages) est hors trajet : ni franchissement ni retard.
export const ROUTE_JUMP_GUARD = { toleranceKm: 2, speedRatio: 1.25, speedMarginKmh: 30, gapMs: 10_000 };

// Plausibilité des durées théoriques (éditeurs, profil de vitesse, test
// d'intégrité) : vitesse moyenne d'un segment, distance à vol d'oiseau entre
// les coordonnées propres à la voie, celle que mesure le moteur. Au-dessus
// de la vitesse de ligne (300 km/h + marge), ou sous le pas d'une approche de
// gare, la durée est presque toujours rangée sur le mauvais segment.
export const ROUTE_SPEED_BOUNDS_KMH = { min: 30, max: 320 };

// Sans fix depuis ce délai, le signal est considéré perdu : la vitesse est
// marquée non fiable. Au-delà de la borne haute, on cesse d'alimenter
// l'historique (app suspendue par l'OS : rien d'utile à tracer).
export const SIGNAL_LOSS_MIN_MS = 15_000;
export const SIGNAL_LOSS_MAX_MS = 300_000;

// Sur le dernier segment, sous cette distance du terminus, l'arrivée est acquise.
export const ARRIVAL_SNAP_KM = 0.2;

// Plafond de l'historique d'acquisition d'une session (24 h à 1 échantillon/s) :
// borne mémoire de sécurité, très au-delà d'un voyage réel.
export const SESSION_MAX_SAMPLES = 86_400;

// Une heure de départ « HH:MM » est rattachée au jour de référence, sauf si
// cela l'éloigne de plus de ce délai : elle appartient alors au jour voisin
// (train parti avant minuit, suivi lancé ou reconfiguré après).
export const DEPARTURE_DAY_ROLLOVER_MS = 18 * 3_600_000;

// Bornes du décalage global ΔT, en minutes.
export const DELTA_MIN_MINUTES = -30;
export const DELTA_MAX_MINUTES = 30;
// Appui maintenu sur − / + : délai avant répétition, puis cadence.
export const DELTA_REPEAT_DELAY_MS = 420;
export const DELTA_REPEAT_INTERVAL_MS = 90;

// Abréviations des noms de points : les données portent toujours la forme
// longue. La courte n'est affichée que si elle fait tenir sur une ligne un nom
// qui, au format « prochain point » du carrousel, en prendrait deux ; le choix
// vaut alors pour tous les affichages de ce nom et suit la taille de l'écran.
export const POINT_NAME_ABBREVIATIONS = [{ prefix: 'Bifurcation ', short: 'Bif. ' }];

// Rendu : animations du carousel et notifications, sans effet sur l'acquisition.
// Réglages de présentation communs aux deux cockpits : car-ui.js les lit aussi.
export const CAROUSEL_ANIMATION_MS = 500;
export const CAROUSEL_HERO_RATIO = 0.48;
export const INFO_DISPLAY_MS = 6000;
export const PROFILE_MAX_COLUMNS = 1600;
// Étendue de la vue « 15 min » du profil.
export const PROFILE_RECENT_WINDOW_MS = 15 * 60_000;
