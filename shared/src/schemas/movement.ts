import { z } from 'zod';

import { locationSchema, timestampSchema } from './primitives.js';

export const movementStateSchema = z.enum([
  'UNKNOWN',
  'STATIONARY',
  'WALKING_VALID',
  'RUNNING',
  'VEHICLE_SUSPECTED',
  'BIKE_SUSPECTED',
  'INVALID',
  'SUSPICIOUS',
]);
export type MovementState = z.infer<typeof movementStateSchema>;

export const activityRecognitionSchema = z.enum([
  'STILL',
  'WALKING',
  'RUNNING',
  'CYCLING',
  'AUTOMOTIVE',
  'UNKNOWN',
]);
export type ActivityRecognition = z.infer<typeof activityRecognitionSchema>;

/**
 * A single raw sensor sample. The mobile client may include an array of these
 * for server-side audit/replay. The server validator can run on either this
 * array OR the summary below. Shape mirrors `docs/07-MOVEMENT-DETECTION.md`.
 */
export const movementSampleSchema = z.object({
  timestamp: timestampSchema,
  location: locationSchema,
  speedMps: z.number().min(0).max(200).nullable(),
  headingDegrees: z.number().gte(0).lt(360).nullable().optional(),
  acceleration: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional(),
  stepCountDelta: z.number().int().min(0).optional(),
  activity: activityRecognitionSchema.optional(),
});
export type MovementSample = z.infer<typeof movementSampleSchema>;

/**
 * A lightweight summary computed by the client over a rolling window.
 * Acceptable to the server in place of a full sample array for low-bandwidth
 * collect requests. Server MAY re-run validation if samples are also attached.
 */
export const movementSummarySchema = z.object({
  windowSeconds: z.number().int().min(5).max(300),
  sampleCount: z.number().int().min(0),
  state: movementStateSchema,
  averageSpeedMps: z.number().min(0),
  maxSpeedMps: z.number().min(0),
  averageAccuracyMeters: z.number().min(0),
  stepRateHz: z.number().min(0).nullable().optional(),
  dominantActivity: activityRecognitionSchema.optional(),
  validationScore: z.number().min(0).max(1),
  generatedAt: timestampSchema,
});
export type MovementSummary = z.infer<typeof movementSummarySchema>;

export const movementValidationResultSchema = z.object({
  valid: z.boolean(),
  state: movementStateSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});
export type MovementValidationResult = z.infer<typeof movementValidationResultSchema>;
