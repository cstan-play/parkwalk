import { z } from 'zod';

/**
 * Unified cursor-based pagination envelope used by every list endpoint.
 * Fixes the inconsistency documented in `docs/03-API-SPECIFICATION.md`
 * (where activity-feed used `before` while the generic section used `cursor`).
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}
