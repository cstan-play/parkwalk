import { z } from 'zod';

import { locationSchema, timestampSchema, uuidSchema } from './primitives.js';
import { movementSampleSchema, movementSummarySchema } from './movement.js';

export const collectRequestSchema = z
  .object({
    entityId: uuidSchema,
    location: locationSchema,
    summary: movementSummarySchema,
    samples: z.array(movementSampleSchema).max(600).optional(),
    clientSentAt: timestampSchema,
  })
  .strict();
export type CollectRequest = z.infer<typeof collectRequestSchema>;

export const collectRewardSchema = z.object({
  pointsEarned: z.number().int().min(0),
  streakDays: z.number().int().min(0),
  dailyScore: z.number().int().min(0),
  allTimeScore: z.number().int().min(0),
});
export type CollectReward = z.infer<typeof collectRewardSchema>;

export const collectResponseSchema = z.object({
  collection: z.object({
    id: uuidSchema,
    entityId: uuidSchema,
    collectedAt: timestampSchema,
    distanceFromEntityMeters: z.number().min(0),
    movementValidated: z.boolean(),
  }),
  rewards: collectRewardSchema,
});
export type CollectResponse = z.infer<typeof collectResponseSchema>;
