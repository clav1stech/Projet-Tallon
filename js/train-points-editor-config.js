export const TRAIN_EDITOR_MAP_CONFIG = {
    railDatasetDescriptorUrl: 'data/datasets/rail-pk.json',
    minStructureEndpointDistanceM: 5,
    markerOffsetPx: 13,
    markerCollisionThresholdKm: 0.03,
    baseTiles: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        }
    },
    railwayTiles: {
        url: 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
        options: {
            maxZoom: 19,
            opacity: 0.85,
            attribution: 'Style &copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
        }
    }
};

export const TRAIN_EDITOR_STRUCTURE_STYLE = {
    color: '#7c3aed',
    weight: 7,
    opacity: 0.8
};

export const TRAIN_EDITOR_VOIES = {
    1: { label: 'Voie 1 · Paris → Province', shortLabel: 'V1', color: '#b43650' },
    2: { label: 'Voie 2 · Province → Paris', shortLabel: 'V2', color: '#2563b8' }
};
