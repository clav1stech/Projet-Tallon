// js/state.js
const STATE = {
    departureTime: null,
    direction: 'north-south',
    pointsDePassage: [],
    trajets: typeof trajets !== 'undefined' ? trajets : [],
    currentDelay: '',
    selectedRoute: '',
    locationMethod: 'geo',
    manualLat: null,
    manualLon: null,
    lastScrolledStationIdx: null,
};

export default STATE;

export function restoreSettings() {
    STATE.selectedRoute = localStorage.getItem('selectedRoute') || '';
    STATE.departureTime = localStorage.getItem('departureTime') || '';
    STATE.locationMethod = localStorage.getItem('locationMethod') || 'geo';
    STATE.manualLat = localStorage.getItem('manualLat') || '';
    STATE.manualLon = localStorage.getItem('manualLon') || '';
}

export function saveSettings() {
    localStorage.setItem('selectedRoute', STATE.selectedRoute);
    localStorage.setItem('departureTime', STATE.departureTime);
    localStorage.setItem('locationMethod', STATE.locationMethod);
    if (STATE.manualLat) localStorage.setItem('manualLat', STATE.manualLat);
    if (STATE.manualLon) localStorage.setItem('manualLon', STATE.manualLon);
}
