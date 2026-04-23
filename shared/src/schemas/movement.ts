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
 * A single raw sensor sample. Collect requests should include a non-empty
 * array of these so the server can run teleport/automotive replay checks
 * (`validateMovement` hard-rejects if samples are missing). Narrative:
 * `docs/07-MOVEMENT-DETECTION.md`; this Zod schema is the wire-shape source
 * of truth.
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
 * Always sent with collect; the server uses it together with `samples`
 * (samples are required for a successful collect today).
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

/**
 * Soft-flag codes emitted by the server validator. These do NOT block a
 * collect; they are persisted into `collection_log.movement_data.flags`
 * for later analytics / anti-cheat triage. Hard rejects land in `reasons`
 * and produce `valid: false`.
 *
 * Kept as a string enum rather than booleans so the set can grow without
 * breaking stored JSONB shapes.
 */
export const movementFlagSchema = z.enum([
  'LOW_GPS_ACCURACY',
  'NO_STEPS_DURING_MOVEMENT',
  'UNKNOWN_ACTIVITY',
  'STALE_SUMMARY',
  'CLIENT_STATE_NOT_WALKING',
  'LOW_CLIENT_SCORE',
  'FLAT_ACCELEROMETER_WITH_GPS',
]);
export type MovementFlag = z.infer<typeof movementFlagSchema>;

export const movementValidationResultSchema = z.object({
  valid: z.boolean(),
  state: movementStateSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  flags: z.array(movementFlagSchema).default([]),
});
export type MovementValidationResult = z.infer<typeof movementValidationResultSchema>;
