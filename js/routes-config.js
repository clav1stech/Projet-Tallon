// js/routes-config.js
// Source unique de vérité pour les routes de l'application.
// Importé par ui.js (sélecteur) ET master-editor.js (éditeur) → tout ajout ici
// apparaît automatiquement dans les deux interfaces.

export const MAIN_ROUTES = {
    PARIS_TO_LPD: {
        label: 'Paris → Lyon-Part-Dieu',
        masterRouteId: 'PAR_LPD_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'LYON_PART_DIEU',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' }
        ]
    },
    PARIS_TO_MACON: {
        label: 'Paris → Mâcon',
        masterRouteId: 'PAR_MAC_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'MACON_LOCHE',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    PARIS_TO_MARSEILLE: {
        label: 'Paris → Marseille',
        masterRouteId: 'PAR_MRS_SUD',
        startPointId: 'PARIS_LYON',
        endPointId: 'MARSEILLE_ST_CHARLES',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'LYON_ST_EX', label: 'Lyon-Saint-Exupéry TGV' },
            { id: 'VALENCE_TGV', label: 'Valence TGV' },
            { id: 'AVIGNON_TGV', label: 'Avignon TGV' },
            { id: 'AIX_TGV', label: 'Aix-en-Provence TGV' }
        ]
    },
    LPD_TO_PARIS: {
        label: 'Lyon-Part-Dieu → Paris',
        masterRouteId: 'LPD_PAR_NORD',
        startPointId: 'LYON_PART_DIEU',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    MACON_TO_PARIS: {
        label: 'Mâcon → Paris',
        masterRouteId: 'MAC_PAR_NORD',
        startPointId: 'MACON_LOCHE',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    },
    MARSEILLE_TO_PARIS: {
        label: 'Marseille → Paris',
        masterRouteId: 'MRS_PAR_NORD',
        startPointId: 'MARSEILLE_ST_CHARLES',
        endPointId: 'PARIS_LYON',
        stopOptions: [
            { id: 'AIX_TGV', label: 'Aix-en-Provence TGV' },
            { id: 'AVIGNON_TGV', label: 'Avignon TGV' },
            { id: 'VALENCE_TGV', label: 'Valence TGV' },
            { id: 'LYON_ST_EX', label: 'Lyon-Saint-Exupéry TGV' },
            { id: 'MACON_LOCHE', label: 'Mâcon-Loché TGV' },
            { id: 'CREUSOT_TGV', label: 'Le Creusot TGV' }
        ]
    }
};
