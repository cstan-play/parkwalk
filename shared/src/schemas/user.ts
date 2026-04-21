import { z } from 'zod';

import { timestampSchema, uuidSchema } from './primitives.js';

export const userStatsSchema = z.object({
  userId: uuidSchema,
  totalDistanceMeters: z.number().int().min(0),
  dailyDistanceMeters: z.number().int().min(0),
  weeklyDistanceMeters: z.number().int().min(0),
  totalCollections: z.number().int().min(0),
  dailyCollections: z.number().int().min(0),
  weeklyCollections: z.number().int().min(0),
  treasuresPlaced: z.number().int().min(0),
  treasuresFoundByOthers: z.number().int().min(0),
  totalWalkingMinutes: z.number().int().min(0),
  dailyWalkingMinutes: z.number().int().min(0),
  currentStreakDays: z.number().int().min(0),
  longestStreakDays: z.number().int().min(0),
  lastActivityDate: z.string().nullable(),
  dailyScore: z.number().int().min(0),
  weeklyScore: z.number().int().min(0),
  allTimeScore: z.number().int().min(0),
  updatedAt: timestampSchema,
});
export type UserStats = z.infer<typeof userStatsSchema>;
