import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seeds a ring of collectibles around SEED_CENTER_LAT/LNG. Drop a GPS pin in
 * Apple Maps / Google Maps at wherever you plan to walk and paste into your
 * backend/.env. Then run `npm run prisma:seed`.
 *
 * SEED_SCATTER_METERS controls the radius of the random scatter (default 500m).
 * Wider scatter in urban/suburban areas increases the chance that at least some
 * markers land on publicly walkable terrain; see docs/13-BOOTSTRAP-IOS.md
 * Phase-1.5 follow-up #1 for the planned "snap to walkable ways" upgrade.
 */
async function main(): Promise<void> {
  const centerLat = Number(process.env.SEED_CENTER_LAT ?? 37.7749);
  const centerLng = Number(process.env.SEED_CENTER_LNG ?? -122.4194);
  const count = Number(process.env.SEED_ENTITY_COUNT ?? 15);
  const scatter = Number(process.env.SEED_SCATTER_METERS ?? 500);

  if (
    Number.isNaN(centerLat) ||
    Number.isNaN(centerLng) ||
    Number.isNaN(count) ||
    Number.isNaN(scatter)
  ) {
    throw new Error(
      'Invalid SEED_CENTER_LAT / SEED_CENTER_LNG / SEED_ENTITY_COUNT / SEED_SCATTER_METERS',
    );
  }

  console.warn(
    `Seeding ${count} entities around (${centerLat}, ${centerLng}) with a ~${scatter}m spread`,
  );

  // Clear prior seed data (safe in dev: deletes everything).
  await prisma.userCollection.deleteMany({});
  await prisma.$executeRawUnsafe(`DELETE FROM game_entities`);

  for (let i = 0; i < count; i++) {
    const { lat, lng } = offsetMeters(
      centerLat,
      centerLng,
      scatter * Math.random(),
      360 * Math.random(),
    );
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
      lng,
      lat,
      JSON.stringify(config),
      radius,
    );
  }

  console.warn('Seed complete.');
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
