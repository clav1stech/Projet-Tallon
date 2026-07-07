// js/car-config.js
// Source unique de vérité pour les itinéraires du mode voiture (car.html).
// Miroir du pattern de routes-config.js (rail) : tout ajout ici apparaît
// automatiquement dans le sélecteur de car.html.
//
// Un itinéraire est une liste ORDONNÉE de "legs" de deux types :
// - 'pk-corridor' : tronçon référencé par PK/PR via un dataset CSV
//   (data/datasets/<datasetId>.json). Adapté aux autoroutes : corridor dense,
//   pas de lacets, aucune logique de cap nécessaire.
// - 'points'      : tronçon défini par des waypoints saisis à la main,
//   projetés sur segments droits (même principe que le rail). Adapté aux
//   routes courtes et globalement rectilignes.
//
// `avgSpeedKmh` : vitesse indicative du leg, utilisée pour l'ETA théorique
// de secours et pour la simulation fakeGeoSim (durées de segments).

export const CAR_ROUTES = {
    MACON_COMBLOUX: {
        label: 'Mâcon → Combloux',
        // Descripteurs de datasets à charger pour cet itinéraire.
        datasets: ['data/datasets/a40-pr.json'],
        legs: [
            {
                type: 'pk-corridor',
                datasetId: 'a40-pr',
                label: 'A40',
                avgSpeedKmh: 110
            },
            {
                type: 'points',
                label: 'Sallanches → Combloux',
                avgSpeedKmh: 45,
                // PLACEHOLDER : coordonnées approximatives de la montée
                // Sallanches → Combloux (D1212), à affiner si besoin.
                // Route courte et globalement rectiligne : la projection sur
                // segments droits suffit, pas de PK nécessaire.
                points: [
                    { id: 'SALLANCHES', name: 'Sallanches (sortie A40)', lat: 45.9330, lon: 6.6280 },
                    { id: 'D1212_MONTEE', name: 'D1212 — montée', lat: 45.9180, lon: 6.6350 },
                    { id: 'COMBLOUX_ENTREE', name: 'Combloux (entrée)', lat: 45.9040, lon: 6.6390 },
                    { id: 'COMBLOUX', name: 'Combloux (centre)', lat: 45.8968, lon: 6.6392 }
                ]
            }
        ]
    }
};
