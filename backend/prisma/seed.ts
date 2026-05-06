import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import {
  parseWalkablePlacementConfig,
  type WalkablePlacementConfig,
} from '../src/modules/entities/placement.config.js';
import {
  type GeoPoint,
  pickRandomPlacement,
} from '../src/modules/entities/placement.geo.js';
import {
  createMemoryWalkableSnapCache,
  findWalkableSnapCandidates,
  type SnappedPlacementCandidate,
  type WalkableSnapMetadata,
} from '../src/modules/entities/walkable-snapping.js';

const prisma = new PrismaClient();
const MAX_ATTEMPTS_PER_MARKER = 200;

/**
 * Seeds a disc of collectibles around SEED_CENTER_LAT/LNG. Drop a GPS pin in
 * Apple Maps / Google Maps wherever you plan to walk and paste into your
 * backend/.env. Then run `npm run prisma:seed`.
 *
 * Configurable via env (see `backend/src/env.ts` for the authoritative schema):
 *   SEED_CENTER_LAT / SEED_CENTER_LNG  — center of the disc
 *   SEED_ENTITY_COUNT                  — how many markers to seed (default 15)
 *   SEED_SCATTER_METERS                — disc radius in meters (default 500m)
 *   SEED_MIN_SPACING_METERS            — rejection-sample so no two markers
 *                                        sit inside each other's collection
 *                                        radius (default 12m; collection
 *                                        radii are 10-15m)
 *   WALKABLE_SNAPPING_ENABLED          — snap seed markers to Mapbox walkable
 *                                        line features when true
 *
 * Sampling: uniform-on-the-disc (`r = R * sqrt(U)`, not `r = R * U`, which
 * would bias toward the center). Combined with rejection sampling, this gives
 * a roughly Poisson-disc layout suitable for small (~50m) neighborhoods as
 * well as multi-km walks.
 */
async function main(): Promise<void> {
  const centerLat = Number(process.env.SEED_CENTER_LAT ?? 37.7749);
  const centerLng = Number(process.env.SEED_CENTER_LNG ?? -122.4194);
  const count = Number(process.env.SEED_ENTITY_COUNT ?? 15);
  const scatter = Number(process.env.SEED_SCATTER_METERS ?? 500);
  const minSpacing = Number(process.env.SEED_MIN_SPACING_METERS ?? 12);
  const snapConfig = parseWalkablePlacementConfig(process.env);

  if (
    Number.isNaN(centerLat) ||
    Number.isNaN(centerLng) ||
    Number.isNaN(count) ||
    Number.isNaN(scatter) ||
    Number.isNaN(minSpacing)
  ) {
    throw new Error(
      'Invalid SEED_CENTER_LAT / _LNG / _ENTITY_COUNT / _SCATTER_METERS / _MIN_SPACING_METERS',
    );
  }

  // Sanity check: area available ≈ πR². Each marker "claims" roughly
  // π(minSpacing)² — so density > ~0.5 guarantees rejection-sampling failure.
  const areaRatio = count * minSpacing * minSpacing / (scatter * scatter);
  if (areaRatio > 0.5) {
    console.warn(
      `WARN: SEED_ENTITY_COUNT=${count} at spacing ${minSpacing}m is tight for a ` +
        `${scatter}m disc (density ${(areaRatio * 100).toFixed(0)}%). Consider ` +
        `a wider SEED_SCATTER_METERS or fewer SEED_ENTITY_COUNT.`,
    );
  }

  console.warn(
    `Seeding ${count} entities around (${centerLat}, ${centerLng}): ` +
      `disc radius ${scatter}m, min spacing ${minSpacing}m`,
  );

  // Clear prior seed data (safe in dev: deletes everything).
  await prisma.userCollection.deleteMany({});
  await prisma.$executeRawUnsafe(`DELETE FROM game_entities`);

  const center = { lat: centerLat, lng: centerLng };
  const placed: GeoPoint[] = [];
  const generatedAt = new Date().toISOString();
  const snappedCandidates = await loadSeedSnappedCandidates({
    center,
    radiusMeters: scatter,
    minSpacingMeters: minSpacing,
    wanted: count,
    snapConfig,
  });

  for (let i = 0; i < count; i++) {
    const snappedCandidate = snappedCandidates[i];
    const fallbackCandidate =
      snappedCandidate === undefined
        ? pickRandomPlacement({
            center,
            radiusMeters: scatter,
            minDistanceMeters: 0,
            minSpacingMeters: minSpacing,
            occupied: placed,
            maxAttempts: MAX_ATTEMPTS_PER_MARKER,
          })
        : null;
    const accepted = snappedCandidate ?? fallbackCandidate;
    if (!accepted) {
      throw new Error(
        `Could not place marker ${i + 1}/${count} after ${MAX_ATTEMPTS_PER_MARKER} attempts. ` +
          `Increase SEED_SCATTER_METERS, decrease SEED_ENTITY_COUNT, or lower SEED_MIN_SPACING_METERS.`,
      );
    }
    placed.push(accepted);

    const isRare = i % 5 === 0;
    const points = isRare ? 100 : 10;
    const radius = isRare ? 15 : 10;
    const config = isRare
      ? {
          name: `Rare Find #${i + 1}`,
          description: 'A rare collectible hidden on your walk',
          rarity: 'rare',
          points,
          iconKey: 'gem',
          placement: seedPlacementMetadata({
            center,
            radiusMeters: scatter,
            generatedAt,
            snapConfig,
            snappedCandidate,
            fallbackCandidate,
          }),
        }
      : {
          name: `Walk Token #${i + 1}`,
          description: 'Collect while walking to earn points',
          points,
          iconKey: 'coin',
          placement: seedPlacementMetadata({
            center,
            radiusMeters: scatter,
            generatedAt,
            snapConfig,
            snappedCandidate,
            fallbackCandidate,
          }),
        };

    await prisma.$executeRawUnsafe(
      `INSERT INTO game_entities (type, location, config, collection_radius_meters)
       VALUES ('collectible', ST_MakePoint($1, $2)::geography, $3::jsonb, $4)`,
      accepted.lng,
      accepted.lat,
      JSON.stringify(config),
      radius,
    );
  }

  console.warn(`Seed complete. Placed ${placed.length} markers.`);
}

async function loadSeedSnappedCandidates(params: {
  center: GeoPoint;
  radiusMeters: number;
  minSpacingMeters: number;
  wanted: number;
  snapConfig: WalkablePlacementConfig;
}): Promise<SnappedPlacementCandidate[]> {
  if (!params.snapConfig.WALKABLE_SNAPPING_ENABLED) return [];
  const snapped = await findWalkableSnapCandidates({
    center: params.center,
    radiusMeters: params.radiusMeters,
    minDistanceMeters: 0,
    minSpacingMeters: params.minSpacingMeters,
    occupied: [],
    wanted: params.wanted,
    config: params.snapConfig,
    cache: createMemoryWalkableSnapCache(),
  });

  if (snapped.length < params.wanted) {
    const message =
      `Walkable snapping found ${snapped.length}/${params.wanted} seed markers. ` +
      `The remaining markers will use random unsnapped fallback.`;
    if (params.snapConfig.WALKABLE_SNAP_REQUIRED) {
      throw new Error(message);
    }
    console.warn(`WARN: ${message}`);
  }

  return snapped;
}

function seedPlacementMetadata(params: {
  center: GeoPoint;
  radiusMeters: number;
  generatedAt: string;
  snapConfig: WalkablePlacementConfig;
  snappedCandidate: SnappedPlacementCandidate | undefined;
  fallbackCandidate: GeoPoint | null;
}): Record<string, unknown> {
  const snap = seedSnapMetadata(params);
  return {
    source: 'manual_seed',
    version: params.snapConfig.WALKABLE_SNAPPING_ENABLED ? 2 : 1,
    center: { latitude: params.center.lat, longitude: params.center.lng },
    radiusMeters: params.radiusMeters,
    generatedAt: params.generatedAt,
    ...(snap ? { snap } : {}),
  };
}

function seedSnapMetadata(params: {
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

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
