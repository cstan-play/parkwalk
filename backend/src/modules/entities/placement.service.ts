import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';

import {
  findActiveEntityLocations,
  insertCollectible,
  type EntityLocationRow,
} from './entities.repository.js';
import type { WalkablePlacementConfig } from './placement.config.js';
import { type GeoPoint, pickRandomPlacement } from './placement.geo.js';
import {
  createRedisWalkableSnapCache,
  findWalkableSnapCandidates,
  type SnappedPlacementCandidate,
  type WalkableSnapMetadata,
} from './walkable-snapping.js';

const MAX_ATTEMPTS_PER_MARKER = 80;
const snapCache = createRedisWalkableSnapCache(redis);
type WalkableSnapFinder = typeof findWalkableSnapCandidates;
let walkableSnapFinder: WalkableSnapFinder = findWalkableSnapCandidates;

export function setWalkableSnapFinderForTests(finder: WalkableSnapFinder | null): void {
  walkableSnapFinder = finder ?? findWalkableSnapCandidates;
}

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

  const center = { lat: params.lat, lng: params.lng };
  const occupied: GeoPoint[] = existing.map((e) => ({ lat: e.lat, lng: e.lng }));
  const inserted: EntityLocationRow[] = [];
  const snapConfig = currentWalkableConfig();
  const snappedCandidates = await loadSnappedCandidates({
    center,
    radiusMeters: radius,
    minDistanceMeters: minDistance,
    minSpacingMeters: minSpacing,
    occupied,
    wanted,
    snapConfig,
  });

  for (let i = 0; i < wanted; i++) {
    const snappedCandidate = snappedCandidates[i];
    const fallbackCandidate =
      snappedCandidate === undefined
        ? pickRandomPlacement({
            center,
            radiusMeters: radius,
            minDistanceMeters: minDistance,
            minSpacingMeters: minSpacing,
            occupied,
            maxAttempts: MAX_ATTEMPTS_PER_MARKER,
          })
        : null;
    const candidate = snappedCandidate ?? fallbackCandidate;
    if (!candidate) break;

    const snap = placementSnapMetadata({
      snapConfig,
      snappedCandidate,
      fallbackCandidate,
    });
    const placementVersion = snapConfig.WALKABLE_SNAPPING_ENABLED ? 2 : 1;

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
          version: placementVersion,
          center: { latitude: params.lat, longitude: params.lng },
          radiusMeters: radius,
          generatedAt: new Date().toISOString(),
          ...(snap ? { snap } : {}),
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
        snapped: snappedCandidates.length,
        center: { lat: params.lat, lng: params.lng },
        radiusMeters: radius,
      },
      'nearby auto-seeded collectibles',
    );
  }

  return inserted.length;
}

async function loadSnappedCandidates(params: {
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters: number;
  minSpacingMeters: number;
  occupied: GeoPoint[];
  wanted: number;
  snapConfig: WalkablePlacementConfig;
}): Promise<SnappedPlacementCandidate[]> {
  if (!params.snapConfig.WALKABLE_SNAPPING_ENABLED) return [];
  try {
    return await walkableSnapFinder({
      center: params.center,
      radiusMeters: params.radiusMeters,
      minDistanceMeters: params.minDistanceMeters,
      minSpacingMeters: params.minSpacingMeters,
      occupied: params.occupied,
      wanted: params.wanted,
      config: params.snapConfig,
      cache: snapCache,
    });
  } catch (err) {
    if (params.snapConfig.WALKABLE_SNAP_REQUIRED) {
      throw err;
    }
    logger.warn({ err }, 'walkable snapping failed; falling back to unsnapped placement');
    return [];
  }
}

function currentWalkableConfig(): WalkablePlacementConfig {
  return {
    MAPBOX_ACCESS_TOKEN: env.MAPBOX_ACCESS_TOKEN,
    WALKABLE_SNAPPING_ENABLED: env.WALKABLE_SNAPPING_ENABLED,
    WALKABLE_SNAP_MAX_METERS: env.WALKABLE_SNAP_MAX_METERS,
    WALKABLE_SNAP_CACHE_TTL_SECONDS: env.WALKABLE_SNAP_CACHE_TTL_SECONDS,
    WALKABLE_SNAP_REQUIRED: env.WALKABLE_SNAP_REQUIRED,
    WALKABLE_TILEQUERY_MAX_CALLS: env.WALKABLE_TILEQUERY_MAX_CALLS,
  };
}

function placementSnapMetadata(params: {
  snapConfig: WalkablePlacementConfig;
  snappedCandidate: SnappedPlacementCandidate | undefined;
  fallbackCandidate: GeoPoint | null;
}): WalkableSnapMetadata | null {
  if (!params.snapConfig.WALKABLE_SNAPPING_ENABLED) return null;
  if (params.snappedCandidate) return params.snappedCandidate.snap;
  if (params.fallbackCandidate) {
    return {
      status: 'fallback_unsnapped',
      provider: 'mapbox_tilequery',
    };
  }
  return null;
}
