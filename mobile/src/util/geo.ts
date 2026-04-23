/**
 * Geodesic helpers used by the mobile client.
 *
 * The backend uses PostGIS (`ST_Distance(geography, geography)`) for its
 * authoritative distance checks. This file exists so the UI can compute a
 * live distance to each marker between `/entities/nearby` refetches —
 * critical because `refetchInterval` is 30 s and cache key only rotates on
 * ~111 m displacement, so cached `distanceMeters` fields rapidly go stale
 * during a walk.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Great-circle distance between two (lat, lng) pairs in meters.
 *
 * Spherical Earth approximation (Haversine). Accurate to ~0.5 % which is
 * well under GPS noise; we only use this output to decide "close enough to
 * tap" — the server re-checks with PostGIS, which is the authority.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
