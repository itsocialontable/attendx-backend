// src/utils/geofence.js — Geofencing Utility

/**
 * Haversine formula: distance in meters between two lat/lng points
 */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Office location from .env
 */
const OFFICE_LAT    = parseFloat(process.env.OFFICE_LAT    || '26.9124');
const OFFICE_LNG    = parseFloat(process.env.OFFICE_LNG    || '75.7873');
const OFFICE_RADIUS = parseFloat(process.env.OFFICE_RADIUS_METERS || '100');

/**
 * Check if given coordinates are within allowed office radius
 * Returns { allowed, distance, radius, message }
 */
function checkGeofence(lat, lng) {
  const distance = getDistanceMeters(OFFICE_LAT, OFFICE_LNG, lat, lng);
  const allowed  = distance <= OFFICE_RADIUS;

  return {
    allowed,
    distance: Math.round(distance),
    radius:   OFFICE_RADIUS,
    officeLat: OFFICE_LAT,
    officeLng: OFFICE_LNG,
    message: allowed
      ? `You are within office premises (${Math.round(distance)}m from office).`
      : `You are ${Math.round(distance)}m away from office. Must be within ${OFFICE_RADIUS}m to check in/out.`,
  };
}

module.exports = { checkGeofence, getDistanceMeters, OFFICE_LAT, OFFICE_LNG, OFFICE_RADIUS };
