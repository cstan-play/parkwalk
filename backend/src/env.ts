import { z } from 'zod';

import { walkablePlacementEnvSchema } from './modules/entities/placement.config.js';

/**
 * Zod-validated env. Fails fast on missing or malformed keys.
 *
 * Deliberately does NOT use `.passthrough()` (the `.unknown()` trap in the
 * original Joi example in docs/04-SETUP-BACKEND.md silently swallowed typos).
 */
const coreEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_VERSION: z.string().default('v1'),

  DATABASE_URL: z.string().url().startsWith('postgres'),

  REDIS_URL: z.string().url().startsWith('redis'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),

  ALLOWED_ORIGINS: z
    .string()
    .default('https://parkwalk-production.up.railway.app,http://localhost:5173')
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean)),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SEED_CENTER_LAT: z.coerce.number().gte(-90).lte(90).default(37.7749),
  SEED_CENTER_LNG: z.coerce.number().gte(-180).lte(180).default(-122.4194),
  SEED_ENTITY_COUNT: z.coerce.number().int().min(1).max(500).default(15),
  SEED_SCATTER_METERS: z.coerce.number().int().min(15).max(5000).default(500),
  SEED_MIN_SPACING_METERS: z.coerce.number().int().min(5).max(500).default(12),

  NEARBY_AUTO_SEED_ENABLED: z.coerce.boolean().default(false),
  NEARBY_AUTO_SEED_TARGET_COUNT: z.coerce.number().int().min(0).max(100).default(12),
  NEARBY_AUTO_SEED_RADIUS_METERS: z.coerce.number().int().min(25).max(1000).default(140),
  NEARBY_AUTO_SEED_MIN_DISTANCE_METERS: z.coerce.number().int().min(5).max(500).default(25),
  NEARBY_AUTO_SEED_MIN_SPACING_METERS: z.coerce.number().int().min(5).max(500).default(18),
});

const envSchema = z.intersection(coreEnvSchema, walkablePlacementEnvSchema);

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.error('Invalid environment variables:', JSON.stringify(flat.fieldErrors, null, 2));
    throw new Error('Environment validation failed. Fix your .env and restart.');
  }
  return parsed.data;
}

export const env = loadEnv();
