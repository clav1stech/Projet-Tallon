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
        name: "Paris - Lyon avec arrêts intermédiaires",
        direction: "south-north",
        pointsFile: "PARLPD1.json" // Utiliser .json si vous avez converti en JSON
    },
    {
        id: "LYNPAR1",
        name: "Lyon - Paris avec arrêts intermédiaires",
        direction: "north-south",
        pointsFile: "LPDPAR1.json" // Utiliser .json si vous avez converti en JSON
    }
    // Ajoutez d'autres trajets ici si nécessaire
];
