import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const timestampSchema = z.string().datetime({ offset: true });

export const latitudeSchema = z.number().gte(-90).lte(90);
export const longitudeSchema = z.number().gte(-180).lte(180);

export const locationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy: z.number().min(0).optional(),
  altitude: z.number().optional(),
});
export type Location = z.infer<typeof locationSchema>;
