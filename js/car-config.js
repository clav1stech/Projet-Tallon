// js/car-config.js
// Source unique de vérité pour les itinéraires du mode voiture (car.html).
// Miroir du pattern de routes-config.js (rail) : tout ajout ici apparaît
// automatiquement dans le sélecteur de car.html.
//
// Un itinéraire est une liste ORDONNÉE de "legs" de deux types :
// - 'pk-corridor' : tronçon référencé par un dataset PR/PK
//   (data/datasets/<datasetId>.json → data/csv/road_trace.csv, généré par
//   python/refine_corridors.py depuis une trace GPS réelle + les PR IGN de
//   road_pr.csv — voir data/raw/README.md). `pkRange: [min, max]` limite le
//   corridor à la portion réellement parcourue (jonctions, sorties).
//   NB : le "pk" de ces corridors est un cumul de km depuis le début du
//   corridor (colonne pk_cum), PAS le numéro de PR réel — celui-ci n'est pas
//   monotone sur l'A40 (sections APRR puis ATMB) ; il reste disponible dans
//   la colonne `numero` du CSV pour un affichage futur.
// - 'points' : tronçon défini par des waypoints saisis à la main, projetés
//   sur segments droits (même principe que le rail).
//
// `reverse: true` sur un leg : parcours à rebours du référentiel source
// (trajet retour sur un corridor tracé dans le sens aller). La géométrie de
// la trace est celle de la chaussée aller — l'écart avec la chaussée opposée
// (~20 m sur autoroute) reste largement sous la tolérance de matching GPS.
//
// `avgSpeedKmh` : vitesse indicative du leg utilisée par la simulation
// fakeGeoSim pour calculer les durées de segments.
//
// `waypoints` (legs 'pk-corridor') : points de passage nommés le long du
// corridor — sorties/échangeurs, ouvrages d'art (viaducs, tunnels) et
// barrières de péage. Chaque entrée contient `pk`, `name`, `type` et peut
// contenir `reversePk`, `lat`/`lon`, `reverseLat`/`reverseLon`, `km` et
// `lengthM` :
// - `pk` est exprimé dans le référentiel pk_cum du corridor (comme pkRange) ;
// - `reversePk` et les coordonnées `reverse*` décrivent la chaussée retour ;
// - `km` est le kilométrage officiel de l'autoroute (= 204 − PR réel pour
//   l'A40, la colonne `numero` de road_pr.csv), conservé pour documentation ;
// - `type` ∈ 'sortie' | 'echangeur' | 'aire' | 'viaduc' | 'tunnel' | 'peage'.
// Les pk sont interpolés entre les PR IGN du corridor (PR réel → pk_cum) et
// ont été validés contre une trace GPS réelle du trajet (< 40 m d'écart hors
// zones sans signal). Un waypoint hors du pkRange du leg est ignoré au build.
// Les listes sont partagées entre l'aller et le retour. `reversePk` permet de
// placer un repère différemment sur la chaussée retour lorsque les bretelles ou
// les ouvrages ne sont pas au même niveau dans les deux sens.
//
// `sectors` / `sector` : secteurs géographiques affichés dans le HUD,
// déclarés dans le référentiel pk du corridor (donc indépendants du sens de
// parcours) — voir findSector() dans car-route.js. Bornes indicatives, à
// affiner à l'usage.
//
// `origin` / `destination` : libellés de départ/arrivée ajoutés comme
// waypoints synthétiques quand aucun leg 'points' ne fournit déjà l'étape.

// --- Données partagées aller/retour ---

// Le GPS routier fournit normalement un flux continu et une vitesse native.
// Le profil voiture privilégie donc la fraîcheur ; le lissage long reste
// réservé au rail, où les sources sont plus irrégulières.
export const CAR_TRACKING_CONFIG = Object.freeze({
    maxSpeedKmh: 160,
    positionHistorySize: 3,
    speedSpikeThresholdKmh: 20,
    speedSpikeStepKmh: 35,
    gpsLostAfterMs: 2500,
    freshnessCheckMs: 500,
    lostGraphSampleMs: 1000,
    geolocationTimeoutMs: 5000,
    geolocationMaximumAgeMs: 500,
    speedHistoryMax: 600,
    arrivalThresholdKm: 0.2
});

const A40_WAYPOINTS = [
    // Sorties et échangeurs (km officiels A40 : autoroutes.fr/WikiSara).
    { pk: 12.683879, name: 'Aire du Musée de la Bresse',                          type: 'aire' },
    { pk: 26.67536,  km: 30,  name: 'Sortie 5 – Bourg-en-Bresse nord',             type: 'sortie' },
    { pk: 33.353851, km: 37,  name: 'Échangeur A39 (Dijon)',                       type: 'echangeur' },
    { pk: 36.792972, km: 40,  name: 'Sortie 6 – Viriat / Bourg centre',            type: 'sortie' },
    { pk: 47.082784, km: 50,  name: 'Sortie 7 – Bourg-en-Bresse sud / Ceyzériat',  type: 'sortie' },
    { pk: 57.08379,  km: 60,  name: "Échangeur A42 (Pont-d'Ain, Lyon)",            type: 'echangeur' },
    { pk: 76.428129, km: 81,  name: 'Sortie 8 – St-Martin-du-Fresne / A404 (Oyonnax)', type: 'sortie' },
    { pk: 86.338617, km: 90,  name: 'Sortie 9 – Sylans / Nantua',                  type: 'sortie' },
    { pk: 102.812187, reversePk: 103.132725, km: 108, name: 'Sortie 10 – Bellegarde-sur-Valserine', type: 'sortie' },
    { pk: 111.436518, reversePk: 111.777118, km: 117, name: 'Sortie 11 – Éloise / Frangy', type: 'sortie' },
    { pk: 133.26425, reversePk: 133.628303, km: 138, name: 'Sortie 13 – Saint-Julien-en-Genevois', type: 'sortie' },
    { pk: 134.037982, km: 140, name: 'Échangeur A41 (Annecy / Genève)',            type: 'echangeur' },
    { pk: 135.394829, reversePk: 136.215904, km: 143, name: 'Sortie 13.1 – Archamps', type: 'sortie' },
    { pk: 145.054929, reversePk: 145.946866, km: 151, name: 'Sortie 14 – Annemasse / A411 (Genève)', type: 'sortie' },
    { pk: 153.583018, reversePk: 154.418716, km: 161, name: 'Sortie 15 – La Vallée Verte', type: 'sortie' },
    {
        pk: 156.095255,
        reversePk: 156.954016,
        lat: 46.12427410248318,
        lon: 6.327460572775609,
        reverseLat: 46.117774551373486,
        reverseLon: 6.33344726330194,
        name: 'Échangeur A40 / A410',
        type: 'echangeur'
    },
    { pk: 162.959534, reversePk: 163.522618, km: 170, name: 'Sortie 16 – Bonneville ouest', type: 'sortie' },
    { pk: 166.56239, reversePk: 167.633486, km: 174, name: 'Sortie 17 – Bonneville est', type: 'sortie' },
    { pk: 180.210039, reversePk: 181.364191, km: 188, name: 'Sortie 19 – Cluses', type: 'sortie' },
    // pk constaté sur la trace GPS (début de bretelle), pas le
    // PR 6 théorique — voir le commentaire du pkRange.
    { pk: 190.95, reversePk: 191.29068, km: 198, name: 'Sortie 20 – Sallanches / Combloux / Megève', type: 'sortie' },
    // Barrières de péage pleine voie, recalées sur la carte.
    { pk: 126.482059, km: 133, name: 'Péage de Viry',                  type: 'peage' },
    { pk: 151.82457,  km: 156, name: 'Péage de Nangy',                 type: 'peage' },
    { pk: 181.075832, reversePk: 181.048822, km: 186, name: 'Péage de Cluses', type: 'peage' },
    // Ouvrages d'art (km = 204 − PR ; le PR du tunnel de Chamoise
    // est recalé sur la géométrie réelle — sortie est du tunnel
    // juste avant le viaduc de Nantua, PR ≈ 120,5).
    { pk: 64.520013, km: 65,  name: 'Viaduc de Poncin',             type: 'viaduc', lengthM: 566 },
    { pk: 80.137326, km: 83.5, name: 'Tunnel de Chamoise',          type: 'tunnel', lengthM: 3300 },
    { pk: 83.407304, km: 86,  name: 'Viaduc de Nantua',             type: 'viaduc', lengthM: 1003 },
    { pk: 84.106513, km: 87,  name: 'Viaduc des Neyrolles',         type: 'viaduc', lengthM: 782 },
    { pk: 85.686236, km: 90,  name: 'Viaduc des Glacières',         type: 'viaduc', lengthM: 214 },
    { pk: 87.587796, km: 92,  name: 'Viaduc de Sylans',             type: 'viaduc', lengthM: 1266 },
    { pk: 89.402165, km: 93,  name: 'Viaduc de Charix',             type: 'viaduc', lengthM: 542 },
    { pk: 92.33, reversePk: 92.618128, km: 94, name: 'Viaduc de Lalleyriat', type: 'viaduc', lengthM: 194 },
    { pk: 92.728217, reversePk: 93.110861, km: 95, name: 'Viaduc de Frébuge', type: 'viaduc', lengthM: 439 },
    { pk: 93.796719, reversePk: 95.088182, km: 96, name: 'Tunnel de Saint-Germain-de-Joux', type: 'tunnel', lengthM: 1196 },
    { pk: 95.93598, reversePk: 96.196631, km: 97, name: 'Viaduc du Tacon', type: 'viaduc', lengthM: 322 },
    { pk: 97.28, reversePk: 97.950133, km: 99, name: 'Tunnel de Châtillon', type: 'tunnel', lengthM: 720 },
    { pk: 97.999383, reversePk: 98.430013, km: 100, name: 'Viaduc de Châtillon', type: 'viaduc', lengthM: 222 },
    { pk: 105.14, reversePk: 106.229365, km: 107, name: 'Viaduc de Bellegarde-sur-Valserine', type: 'viaduc', lengthM: 1040 },
    { pk: 117.142304, reversePk: 118.519803, km: 120, name: 'Tunnel du Vuache', type: 'tunnel', lengthM: 1400 }
];

// Secteurs A40 (bornes pk_cum indicatives, à affiner à l'usage) :
// Mâconnais jusqu'à la plaine de Bresse, Bugey/"pays des Titans" pour la
// section des grands ouvrages (Poncin → Châtillon), puis Bellegarde,
// Genevois, vallée de l'Arve et pays du Mont-Blanc.
const A40_SECTORS = [
    { name: 'Mâconnais',      pkFrom: 0,      pkTo: 18 },
    { name: 'Bresse',         pkFrom: 18,     pkTo: 59.21 },
    { name: 'Bugey / Titans', pkFrom: 59.21,  pkTo: 100 },
    { name: 'Bellegarde',     pkFrom: 100,    pkTo: 118 },
    { name: 'Genevois',       pkFrom: 118,    pkTo: 150 },
    { name: 'Arve',           pkFrom: 150,    pkTo: 184.7 },
    { name: 'Mont-Blanc',     pkFrom: 184.7,  pkTo: 195 }
];

const A406_WAYPOINTS = [
    { pk: 8.109835, name: 'Péage Mâcon – Val de Saône', type: 'peage' }
];

// Descripteurs de datasets à charger (communs aux deux sens).
// Corridors "trace" : géométrie fine issue d'une trace GPS réelle du
// trajet (python/refine_corridors.py), PR interpolés dans le même
// référentiel pk_cum que les corridors PR IGN d'origine (aXX-pr.json,
// conservés en repli).
const MACON_COMBLOUX_DATASETS = [
    'data/datasets/a406-trace.json',
    'data/datasets/a40-trace.json',
    'data/datasets/d1212-trace.json'
];

const COMBLOUX_POINTS = [
    { id: 'COMBLOUX', name: 'Combloux (centre)', lat: 45.8903069, lon: 6.6419649 }
];

export const CAR_ROUTES = {
    MACON_COMBLOUX: {
        label: 'Mâcon → Combloux',
        origin: 'Mâcon (A406)',
        datasets: MACON_COMBLOUX_DATASETS,
        legs: [
            {
                type: 'pk-corridor',
                datasetId: 'a406-trace',
                label: 'A406',
                avgSpeedKmh: 100,
                sector: 'Mâconnais',
                waypoints: A406_WAYPOINTS
                // Corridor complet : contournement sud de Mâcon, de l'A6 à l'A40.
            },
            {
                type: 'pk-corridor',
                datasetId: 'a40-trace',
                label: 'A40',
                avgSpeedKmh: 110,
                // On rejoint l'A40 à la jonction A406 (pk_cum ≈ 6,0). La trace
                // GPS montre que la bretelle de la sortie Sallanches quitte la
                // chaussée vers pk_cum ≈ 191,3 (et non 194,7 comme le suggérait
                // le PR 6 ATMB : le kilométrage officiel de la sortie ne
                // coïncide pas avec la géométrie du corridor chaîné).
                pkRange: [5.9, 191.3],
                sectors: A40_SECTORS,
                waypoints: A40_WAYPOINTS
            },
            {
                type: 'pk-corridor',
                datasetId: 'd1212-trace',
                label: 'D1212',
                avgSpeedKmh: 45,
                sector: 'Mont-Blanc',
                // Sallanches (PR 0) → Combloux ; la trace GPS suit la D1212
                // jusqu'à pk_cum ≈ 6,4 (et non 5,3) avant d'obliquer vers le
                // centre. La D1212 continue ensuite vers Megève, hors trajet.
                pkRange: [0, 6.4]
            },
            {
                type: 'points',
                label: 'Combloux',
                avgSpeedKmh: 40,
                sector: 'Mont-Blanc',
                points: COMBLOUX_POINTS
            }
        ]
    },

    COMBLOUX_MACON: {
        label: 'Combloux → Mâcon',
        destination: 'Mâcon (A6)',
        datasets: MACON_COMBLOUX_DATASETS,
        // Mêmes corridors parcourus à rebours (`reverse`) : géométrie de la
        // chaussée aller, tolérance GPS suffisante pour la chaussée opposée.
        legs: [
            {
                type: 'points',
                label: 'Combloux',
                avgSpeedKmh: 40,
                sector: 'Mont-Blanc',
                points: COMBLOUX_POINTS
            },
            {
                type: 'pk-corridor',
                datasetId: 'd1212-trace',
                label: 'D1212',
                avgSpeedKmh: 45,
                sector: 'Mont-Blanc',
                pkRange: [0, 6.4],
                reverse: true
            },
            {
                type: 'pk-corridor',
                datasetId: 'a40-trace',
                label: 'A40',
                avgSpeedKmh: 110,
                pkRange: [5.9, 191.3],
                sectors: A40_SECTORS,
                waypoints: A40_WAYPOINTS,
                reverse: true
            },
            {
                type: 'pk-corridor',
                datasetId: 'a406-trace',
                label: 'A406',
                avgSpeedKmh: 100,
                sector: 'Mâconnais',
                waypoints: A406_WAYPOINTS,
                reverse: true
            }
        ]
    }
};
