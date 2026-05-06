import { z } from 'zod';

function envBoolean(defaultValue: boolean): z.ZodEffects<z.ZodTypeAny, boolean> {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());
}

export const walkablePlacementEnvSchema = z
  .object({
    MAPBOX_ACCESS_TOKEN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    WALKABLE_SNAPPING_ENABLED: envBoolean(false),
    WALKABLE_SNAP_MAX_METERS: z.coerce.number().int().min(1).max(250).default(35),
    WALKABLE_SNAP_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(7 * 24 * 60 * 60).default(86400),
    WALKABLE_SNAP_REQUIRED: envBoolean(false),
    WALKABLE_TILEQUERY_MAX_CALLS: z.coerce.number().int().min(0).max(25).default(8),
  })
  .superRefine((value, ctx) => {
    if (value.WALKABLE_SNAPPING_ENABLED && !value.MAPBOX_ACCESS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAPBOX_ACCESS_TOKEN'],
        message: 'MAPBOX_ACCESS_TOKEN is required when WALKABLE_SNAPPING_ENABLED=true',
      });
    }
  });

export type WalkablePlacementConfig = z.infer<typeof walkablePlacementEnvSchema>;

export function parseWalkablePlacementConfig(
  raw: Record<string, unknown>,
): WalkablePlacementConfig {
  return walkablePlacementEnvSchema.parse(raw);
}
