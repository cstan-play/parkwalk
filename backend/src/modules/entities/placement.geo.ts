export interface GeoPoint {
  lat: number;
  lng: number;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const radiusMeters = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function offsetMeters(
  origin: GeoPoint,
  meters: number,
  bearingDegrees: number,
): GeoPoint {
  const radiusMeters = 6371000;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(meters / radiusMeters) +
      Math.cos(lat1) * Math.sin(meters / radiusMeters) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(meters / radiusMeters) * Math.cos(lat1),
      Math.cos(meters / radiusMeters) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

export function randomDiscPoint(params: {
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters?: number;
  rng?: () => number;
}): GeoPoint {
  const rng = params.rng ?? Math.random;
  const minDistanceMeters = Math.min(params.minDistanceMeters ?? 0, params.radiusMeters);
  const availableRadius = Math.max(0, params.radiusMeters - minDistanceMeters);
  const distance = minDistanceMeters + availableRadius * Math.sqrt(rng());
  return offsetMeters(params.center, distance, 360 * rng());
}

export function isPlacementValid(params: {
  point: GeoPoint;
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters: number;
  minSpacingMeters: number;
  occupied: GeoPoint[];
}): boolean {
  const centerDistance = haversineMeters(params.center, params.point);
  if (centerDistance > params.radiusMeters) return false;
  if (centerDistance < params.minDistanceMeters) return false;
  return !params.occupied.some(
    (p) => haversineMeters(p, params.point) < params.minSpacingMeters,
  );
}

export function pickRandomPlacement(params: {
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters: number;
  minSpacingMeters: number;
  occupied: GeoPoint[];
  maxAttempts: number;
  rng?: () => number;
}): GeoPoint | null {
  for (let attempt = 0; attempt < params.maxAttempts; attempt++) {
    const candidate = randomDiscPoint({
      center: params.center,
      radiusMeters: params.radiusMeters,
      minDistanceMeters: params.minDistanceMeters,
      rng: params.rng,
    });
    if (
      isPlacementValid({
        point: candidate,
        center: params.center,
        radiusMeters: params.radiusMeters,
        minDistanceMeters: params.minDistanceMeters,
        minSpacingMeters: params.minSpacingMeters,
        occupied: params.occupied,
      })
    ) {
      return candidate;
    }
  }
  return null;
}
