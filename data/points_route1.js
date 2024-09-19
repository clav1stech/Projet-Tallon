// data/points_route1.js

const pointsDePassage = [
            { name: "Paris-Lyon", PK: 0.000, duree: 0, lat: 48.84431, lon: 2.37564, retard: 0 },
            { name: "Bif. de Créteil", PK: 9.326, duree: 350, lat: 48.77490, lon: 2.43626, retard: 0 },
            { name: "Tunnel de Limeil-Brevannes", PK: 4.117, duree: 142, lat: 48.74884, lon: 2.47240, retard: 0 },
            { name: "Tranchée couverte de Villecresne", PK: 7.633, duree: 118, lat: 48.73355, lon: 2.50744, retard: 0 },
            { name: "Bif. de Chevry-Cossigny", PK: 21.486, duree: 300, lat: 48.70186, lon: 2.68159, retard: 0 },
            { name: "Bif. V.1 de Solers", PK: 26.500, duree: 86, lat: 48.67599, lon: 2.72792, retard: 0 },
            { name: "Bif. de Moisenay", PK: 17.099, duree: 220, lat: 48.56911, lon: 2.75358, retard: 0 },
            { name: "Viaduc de Montereau", PK: 42.740, duree: 343, lat: 48.39683, lon: 2.97820, retard: 0 },
            { name: "PRS de Marolles", PK: 49.230, duree: 83, lat: 48.37260, lon: 3.05381, retard: 0 },
            { name: "Passage sous l'A19", PK: 72.200, duree: 299, lat: 48.25960, lon: 3.28652, retard: 0 },
            { name: "PRS de Vaumort", PK: 92.778, duree: 290, lat: 48.11586, lon: 3.44976, retard: 0 },
            { name: "Viaduc sur le canal de Bourgogne", PK: 115.752, duree: 294, lat: 47.98193, lon: 3.67834, retard: 0 },
            { name: "Bif. (V. 2) de Vergigny vers le racc. sud", PK: 117.959, duree: 26, lat: 47.97407, lon: 3.69335, retard: 0 },
            { name: "PRS Tonnerre", PK: 139.817, duree: 290, lat: 47.85008, lon: 3.92233, retard: 0 },
            { name: "Bif. V.1 de Pasilly", PK: 161.746, duree: 294, lat: 47.68374, lon: 4.07910, retard: 0 },
            { name: "Viaduc d'Époisses", PK: 185.353, duree: 330, lat: 47.48607, lon: 4.15635, retard: 0 },
            { name: "PRS de Lacour d'Arcenay", PK: 202.367, duree: 255, lat: 47.34790, lon: 4.24603, retard: 0 },
            { name: "Viaduc de Saulieu", PK: 208.686, duree: 95, lat: 47.29473, lon: 4.27178, retard: 0 },
            { name: "PRS de Vianges", PK: 225.809, duree: 225, lat: 47.14900, lon: 4.34201, retard: 0 },
            { name: "PRS de Sully", PK: 247.214, duree: 270, lat: 46.99679, lon: 4.45548, retard: 0 },
            { name: "Viaduc de la Digoine (Drée)", PK: 253.454, duree: 85, lat: 46.94780, lon: 4.48808, retard: 0 },
            { name: "Le Creusot – Montceau – Montchanin", PK: 273.816, duree: 284, lat: 46.76534, lon: 4.50010, retard: 0 },
            { name: "PRS de Vaux-en-Pré", PK: 292.995, duree: 279, lat: 46.61190, lon: 4.60418, retard: 0 },
            { name: "PRS de Cluny", PK: 313.579, duree: 270, lat: 46.43449, lon: 4.67387, retard: 0 },
            { name: "Viaduc de la Roche", PK: 321.187, duree: 108, lat: 46.37125, lon: 4.67518, retard: 0 },
            { name: "Macon – Loché TGV", PK: 333.917, duree: 165, lat: 46.28338, lon: 4.77797, retard: 0 },
            { name: "PRS de Cessein", PK: 361.134, duree: 392, lat: 46.06674, lon: 4.84928, retard: 0 },
            { name: "Passage sous l'A46", PK: 379.572, duree: 260, lat: 45.90156, lon: 4.87495, retard: 0 },
            { name: "Bif. V.1 de Montanay", PK: 380.540, duree: 13, lat: 45.89360, lon: 4.87707, retard: 0 },
            { name: "Pont sur l'A46", PK: 385.133, duree: 62, lat: 45.86041, lon: 4.90772, retard: 0 },
            { name: "Viaduc de la Cotière", PK: 394.060, duree: 125, lat: 45.84303, lon: 5.01456, retard: 0 },
            { name: "Lyon-Saint-Exupéry TGV", PK: 409.705, duree: 205, lat: 45.72106, lon: 5.07589, retard: 0 },
            { name: "Bif. (V. 1) de Grenay-Nord", PK: 416.647, duree: 95, lat: 45.66017, lon: 5.07287, retard: 0 },
            { name: "Tunnel de Meyssiez", PK: 440.545, duree: 340, lat: 45.46091, lon: 5.04418, retard: 0 },
            { name: "Viaduc de la Galaure", PK: 471.869, duree: 395, lat: 45.19677, lon: 4.91898, retard: 0 },
            { name: "PRCI de Claveyson - Bren", PK: 476.336, duree: 58, lat: 45.15760, lon: 4.92203, retard: 0 },
            { name: "Valence TGV", PK: 495.464, duree: 245, lat: 44.99112, lon: 4.97879, retard: 0 },
            { name: "Tunnel de Tartaiguille (2 340 m)", PK: 531.661, duree: 500, lat: 44.68243, lon: 4.93530, retard: 0 },
            { name: "SEI d'Allan", PK: 556.011, duree: 314, lat: 44.49641, lon: 4.77729, retard: 0 },
            { name: "Viaduc sur l'A7", PK: 569.737, duree: 180, lat: 44.37792, lon: 4.73232, retard: 0 },
            { name: "Bif. (V. 1) vers le racc. de Bollène", PK: 578.411, duree: 115, lat: 44.30675, lon: 4.70120, retard: 0 },
            { name: "SEI de Piolenc", PK: 595.040, duree: 230, lat: 44.16485, lon: 4.73397, retard: 0 },
            { name: "Bif. (V. 1) d'Avignon-Nord", PK: 617.742, duree: 330, lat: 43.97382, lon: 4.73681, retard: 0 },
            { name: "Avignon TGV", PK: 625.162, duree: 180, lat: 43.92171, lon: 4.78642, retard: 0 },
            { name: "Viaduc de Cheval-Blanc (900 m)", PK: 650.559, duree: 660, lat: 43.80702, lon: 5.04268, retard: 0 },
            { name: "Viaduc de Vernègues (1 211 m)", PK: 669.022, duree: 240, lat: 43.68812, lon: 5.19707, retard: 0 },
            { name: "Viaduc de Ventabren (1 730 m)", PK: 688.232, duree: 300, lat: 43.54931, lon: 5.32919, retard: 0 },
            { name: "Aix-en-Provence TGV", PK: 699.140, duree: 240, lat: 43.45553, lon: 5.31718, retard: 0 },
            { name: "Tunnel des Pennes-Mirabeau", PK: 702.280, duree: 240, lat: 43.42822, lon: 5.32977, retard: 0 },
            { name: "Bif. des Tuileries", PK: 711.001, duree: 300, lat: 43.35441, lon: 5.35259, retard: 0 },
            { name: "Marseille Saint-Charles", PK: 861.800, duree: 360, lat: 43.30334, lon: 5.38096, retard: 0 },
];
