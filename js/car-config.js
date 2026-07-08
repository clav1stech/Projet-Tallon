// js/car-config.js
// Source unique de vérité pour les itinéraires du mode voiture (car.html).
// Miroir du pattern de routes-config.js (rail) : tout ajout ici apparaît
// automatiquement dans le sélecteur de car.html.
//
// Un itinéraire est une liste ORDONNÉE de "legs" de deux types :
// - 'pk-corridor' : tronçon référencé par un dataset PR/PK
//   (data/datasets/<datasetId>.json → data/csv/road_pr.csv, généré par
//   python/extract_pr.py depuis les données IGN de data/raw/ — voir
//   data/raw/README.md). `pkRange: [min, max]` limite le corridor à la
//   portion réellement parcourue (jonctions, sorties).
//   NB : le "pk" de ces corridors est un cumul de km depuis le début du
//   corridor (colonne pk_cum), PAS le numéro de PR réel — celui-ci n'est pas
//   monotone sur l'A40 (sections APRR puis ATMB) ; il reste disponible dans
//   la colonne `numero` du CSV pour un affichage futur.
// - 'points' : tronçon défini par des waypoints saisis à la main, projetés
//   sur segments droits (même principe que le rail).
//
// `avgSpeedKmh` : vitesse indicative du leg, utilisée pour l'ETA théorique
// de secours et pour la simulation fakeGeoSim (durées de segments).

export const CAR_ROUTES = {
    MACON_COMBLOUX: {
        label: 'Mâcon → Combloux',
        // Descripteurs de datasets à charger pour cet itinéraire.
        datasets: [
            'data/datasets/a406-pr.json',
            'data/datasets/a40-pr.json',
            'data/datasets/d1212-pr.json'
        ],
        legs: [
            {
                type: 'pk-corridor',
                datasetId: 'a406-pr',
                label: 'A406',
                avgSpeedKmh: 100
                // Corridor complet : contournement sud de Mâcon, de l'A6 à l'A40.
            },
            {
                type: 'pk-corridor',
                datasetId: 'a40-pr',
                label: 'A40',
                avgSpeedKmh: 110,
                // On rejoint l'A40 à la jonction A406 (pk_cum ≈ 6,0) et on la
                // quitte à la sortie Sallanches (PR 6 ATMB, pk_cum ≈ 194,7).
                pkRange: [5.9, 195]
            },
            {
                type: 'pk-corridor',
                datasetId: 'd1212-pr',
                label: 'D1212',
                avgSpeedKmh: 45,
                // Sallanches (PR 0) → Combloux (PR 7, pk_cum ≈ 5,3) ; la D1212
                // continue ensuite vers Megève, hors trajet.
                pkRange: [0, 5.3]
            },
            {
                type: 'points',
                label: 'Combloux',
                avgSpeedKmh: 40,
                points: [
                    { id: 'COMBLOUX', name: 'Combloux (centre)', lat: 45.8968, lon: 6.6392 }
                ]
            }
        ]
    }
};
