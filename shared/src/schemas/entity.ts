import { z } from 'zod';

import { locationSchema, timestampSchema, uuidSchema } from './primitives.js';

export const entityTypeSchema = z.enum([
  'collectible',
  'treasure',
  'challenge',
  'meeting_point',
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const collectibleConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  points: z.number().int().min(0).max(10000).default(10),
  iconKey: z.string().default('default_collectible'),
  respawnSeconds: z.number().int().min(0).optional(),
});
export type CollectibleConfig = z.infer<typeof collectibleConfigSchema>;

export const treasureConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']).default('common'),
  points: z.number().int().min(0).max(100000).default(100),
  hint: z.string().max(200).optional(),
  iconKey: z.string().default('default_treasure'),
});
export type TreasureConfig = z.infer<typeof treasureConfigSchema>;

export const gameEntitySchema = z.object({
  id: uuidSchema,
  type: entityTypeSchema,
  creatorId: uuidSchema.nullable(),
  location: locationSchema,
  active: z.boolean(),
  visibleFrom: timestampSchema,
  visibleUntil: timestampSchema.nullable(),
  config: z.record(z.string(), z.unknown()),
  collectionRadiusMeters: z.number().int().min(5).max(100),
  maxCollections: z.number().int().min(1).nullable(),
  currentCollections: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  distanceMeters: z.number().optional(),
});
export type GameEntity = z.infer<typeof gameEntitySchema>;

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
  radiusMeters: z.coerce.number().int().min(10).max(5000).default(500),
  type: entityTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
