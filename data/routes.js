// data/routes.js

const trajets = [
    {
        id: "PARMRS",
        name: "Paris - Marseille",
        direction: "south-north", // 'north-south' ou 'south-north'
        pointsFile: "points_route1.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "MRSPAR",
        name: "Marseille - Paris",
        direction: "north-south",
        pointsFile: "points_route2.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "PARLPD0",
        name: "Paris - Lyon sans arrêt",
        direction: "south-north", // 'north-south' ou 'south-north'
        pointsFile: "PARLPD0.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "LPDPAR0",
        name: "Lyon - Paris sans arrêt",
        direction: "north-south",
        pointsFile: "LPDPAR0.json" // Utiliser .json si vous avez converti en JSON
    }
    // Ajoutez d'autres trajets ici si nécessaire
];
