process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://parkwalk:parkwalk_dev@localhost:5432/parkwalk?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'integration-test-secret-at-least-32-chars';
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000';
process.env.NEARBY_AUTO_SEED_ENABLED = process.env.NEARBY_AUTO_SEED_ENABLED ?? 'true';
process.env.NEARBY_AUTO_SEED_TARGET_COUNT = process.env.NEARBY_AUTO_SEED_TARGET_COUNT ?? '5';
process.env.NEARBY_AUTO_SEED_RADIUS_METERS = process.env.NEARBY_AUTO_SEED_RADIUS_METERS ?? '90';
process.env.NEARBY_AUTO_SEED_MIN_DISTANCE_METERS =
  process.env.NEARBY_AUTO_SEED_MIN_DISTANCE_METERS ?? '20';
process.env.NEARBY_AUTO_SEED_MIN_SPACING_METERS =
  process.env.NEARBY_AUTO_SEED_MIN_SPACING_METERS ?? '15';
