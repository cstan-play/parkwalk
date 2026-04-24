import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';

import {
  findActiveEntityLocations,
  insertCollectible,
  type EntityLocationRow,
} from './entities.repository.js';

const MAX_ATTEMPTS_PER_MARKER = 80;

export async function ensureNearbyCollectibles(params: {
  visibleCount: number;
  lat: number;
  lng: number;
  queryRadiusMeters: number;
  type?: string;
}): Promise<number> {
  if (!env.NEARBY_AUTO_SEED_ENABLED) return 0;
  if (params.type && params.type !== 'collectible') return 0;
  if (env.NEARBY_AUTO_SEED_TARGET_COUNT <= 0) return 0;
  if (params.visibleCount >= env.NEARBY_AUTO_SEED_TARGET_COUNT) return 0;

  const wanted = env.NEARBY_AUTO_SEED_TARGET_COUNT - params.visibleCount;
  const radius = Math.min(env.NEARBY_AUTO_SEED_RADIUS_METERS, params.queryRadiusMeters);
  const minDistance = Math.min(env.NEARBY_AUTO_SEED_MIN_DISTANCE_METERS, Math.max(5, radius - 5));
  const minSpacing = env.NEARBY_AUTO_SEED_MIN_SPACING_METERS;
  const existing = await findActiveEntityLocations(prisma, {
    lat: params.lat,
    lng: params.lng,
    radiusMeters: radius + minSpacing,
    type: 'collectible',
    limit: 500,
  });

  const occupied = existing.map((e) => ({ lat: e.lat, lng: e.lng }));
  const inserted: EntityLocationRow[] = [];

  for (let i = 0; i < wanted; i++) {
    const candidate = pickCandidate({
      centerLat: params.lat,
      centerLng: params.lng,
      radiusMeters: radius,
      minDistanceMeters: minDistance,
      minSpacingMeters: minSpacing,
      occupied,
    });
    if (!candidate) break;

    const index = params.visibleCount + inserted.length + 1;
    const isRare = index % 6 === 0;
    const id = await insertCollectible(prisma, {
      lat: candidate.lat,
      lng: candidate.lng,
      collectionRadiusMeters: isRare ? 15 : 12,
      maxCollections: null,
      config: {
        name: isRare ? `Nearby Rare #${index}` : `Nearby Token #${index}`,
        description: 'Auto-seeded near a walk test location',
        points: isRare ? 50 : 10,
        iconKey: isRare ? 'gem' : 'coin',
        placement: {
          source: 'nearby_auto_seed',
          version: 1,
          center: { latitude: params.lat, longitude: params.lng },
          radiusMeters: radius,
          generatedAt: new Date().toISOString(),
        },
      },
    });
    occupied.push(candidate);
    inserted.push({ id, lat: candidate.lat, lng: candidate.lng });
  }

  if (inserted.length > 0) {
    logger.info(
      {
        inserted: inserted.length,
        center: { lat: params.lat, lng: params.lng },
        radiusMeters: radius,
      },
      'nearby auto-seeded collectibles',
    );
  }

  return inserted.length;
}

function pickCandidate(params: {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  minDistanceMeters: number;
  minSpacingMeters: number;
  occupied: Array<{ lat: number; lng: number }>;
}): { lat: number; lng: number } | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MARKER; attempt++) {
    const distance =
      params.minDistanceMeters +
      (params.radiusMeters - params.minDistanceMeters) * Math.sqrt(Math.random());
    const bearing = Math.random() * 360;
    const candidate = offsetMeters(params.centerLat, params.centerLng, distance, bearing);
    const tooClose = params.occupied.some(
      (p) => haversineMeters(p.lat, p.lng, candidate.lat, candidate.lng) < params.minSpacingMeters,
    );
    if (!tooClose) return candidate;
  }
  return null;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radiusMeters = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

function offsetMeters(
  lat: number,
  lng: number,
  meters: number,
  bearingDegrees: number,
): { lat: number; lng: number } {
  const radiusMeters = 6371000;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
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
