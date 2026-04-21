/**
 * Integration test harness assumes `npm run infra:up` has been executed
 * AND the database has had `prisma migrate deploy` applied.
 *
 * To run:
 *   docker compose -f ../infra/docker-compose.yml up -d
 *   npx prisma migrate deploy
 *   npm run test:integration
 */
import { prisma } from '../../src/prisma.js';
import { redis } from '../../src/redis.js';

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE user_collections RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE game_entities RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE user_stats RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE sessions RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE users RESTART IDENTITY CASCADE`);
  await redis.flushdb();
}

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});
