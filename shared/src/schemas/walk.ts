import { z } from 'zod';

import { locationSchema, timestampSchema, uuidSchema } from './primitives.js';

export const walkSessionStatusSchema = z.enum([
  'completed',
  'auto_completed',
  'recovered_after_termination',
]);
export type WalkSessionStatus = z.infer<typeof walkSessionStatusSchema>;

export const walkPathPointSchema = locationSchema.extend({
  recordedAt: timestampSchema,
  stepCountTotal: z.number().int().min(0).optional(),
  source: z.enum(['gps', 'best_fix']).default('gps'),
});
export type WalkPathPoint = z.infer<typeof walkPathPointSchema>;

export const walkPathSegmentSchema = z.object({
  startedAt: timestampSchema,
  endedAt: timestampSchema,
  points: z.array(walkPathPointSchema).max(20_000),
});
export type WalkPathSegment = z.infer<typeof walkPathSegmentSchema>;

export const walkPauseIntervalSchema = z.object({
  startedAt: timestampSchema,
  endedAt: timestampSchema,
});
export type WalkPauseInterval = z.infer<typeof walkPauseIntervalSchema>;

export const walkSessionSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  status: walkSessionStatusSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema,
  durationSeconds: z.number().int().min(0),
  movingDurationSeconds: z.number().int().min(0),
  pausedDurationSeconds: z.number().int().min(0),
  distanceMeters: z.number().min(0),
  stepCount: z.number().int().min(0),
  collectedCount: z.number().int().min(0),
  autoFinished: z.boolean(),
  autoFinishReason: z.string().nullable(),
  pathPointCount: z.number().int().min(0),
  pathSegments: z.array(walkPathSegmentSchema),
  pauseIntervals: z.array(walkPauseIntervalSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type WalkSession = z.infer<typeof walkSessionSchema>;

export const syncWalkRequestSchema = z
  .object({
    clientId: uuidSchema,
    status: walkSessionStatusSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    durationSeconds: z.number().int().min(0),
    movingDurationSeconds: z.number().int().min(0),
    pausedDurationSeconds: z.number().int().min(0).default(0),
    distanceMeters: z.number().min(0),
    stepCount: z.number().int().min(0),
    collectedCount: z.number().int().min(0).default(0),
    autoFinished: z.boolean().default(false),
    autoFinishReason: z.string().max(120).nullable().optional(),
    pathSegments: z.array(walkPathSegmentSchema).max(500),
    pauseIntervals: z.array(walkPauseIntervalSchema).max(500).default([]),
  })
  .strict();
export type SyncWalkRequest = z.infer<typeof syncWalkRequestSchema>;

export const syncWalkResponseSchema = z.object({
  walk: walkSessionSchema,
});
export type SyncWalkResponse = z.infer<typeof syncWalkResponseSchema>;

export const walkListResponseSchema = z.object({
  items: z.array(walkSessionSchema.omit({ pathSegments: true })),
});
export type WalkListResponse = z.infer<typeof walkListResponseSchema>;

export const walkDetailResponseSchema = z.object({
  walk: walkSessionSchema,
});
export type WalkDetailResponse = z.infer<typeof walkDetailResponseSchema>;
