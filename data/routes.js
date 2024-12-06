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
        id: "LYNPAR0",
        name: "Lyon - Paris sans arrêt",
        direction: "north-south",
        pointsFile: "LPDPAR0.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "PARLPD1",
        name: "Paris - Lyon via Le Creusot",
        direction: "south-north",
        pointsFile: "PARLPD1.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "LYNPAR1",
        name: "Lyon - Paris via Le Creusot",
        direction: "north-south",
        pointsFile: "LPDPAR1.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "MLTPAR0",
        name: "Macon TGV - Paris sans arrêt",
        direction: "north-south",
        pointsFile: "MLTPAR0.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "PARMLT0",
        name: "Paris – Macon TGV",
        direction: "south-north",
        pointsFile: "PARMLT0.json" // Utiliser .json si vous avez converti en JSON
    }

    // Ajoutez d'autres trajets ici si nécessaire
];
