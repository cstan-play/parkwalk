import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

  const placed: { lat: number; lng: number }[] = [];
  const maxAttemptsPerMarker = 200;

  for (let i = 0; i < count; i++) {
    let accepted: { lat: number; lng: number } | null = null;
    for (let attempt = 0; attempt < maxAttemptsPerMarker; attempt++) {
      const candidate = offsetMeters(
        centerLat,
        centerLng,
        scatter * Math.sqrt(Math.random()),
        360 * Math.random(),
      );
      const tooClose = placed.some(
        (p) => haversineMeters(p.lat, p.lng, candidate.lat, candidate.lng) < minSpacing,
      );
      if (!tooClose) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) {
      throw new Error(
        `Could not place marker ${i + 1}/${count} after ${maxAttemptsPerMarker} attempts. ` +
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
        }
      : {
          name: `Walk Token #${i + 1}`,
          description: 'Collect while walking to earn points',
          points,
          iconKey: 'coin',
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function offsetMeters(
  lat: number,
  lng: number,
  meters: number,
  bearingDegrees: number,
): { lat: number; lng: number } {
  const R = 6371000;
  const b = (bearingDegrees * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(meters / R) + Math.cos(lat1) * Math.sin(meters / R) * Math.cos(b),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(meters / R) * Math.cos(lat1),
      Math.cos(meters / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
