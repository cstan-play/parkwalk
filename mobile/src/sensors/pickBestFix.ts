import type { GeoPosition } from 'react-native-geolocation-service';

export const FIX_MAX_AGE_MS = 10_000;

/**
 * "Best recent fix" smoother.
 *
 * Selects the GPS fix with the lowest `horizontalAccuracy` among buffered
 * fixes received in the last FIX_MAX_AGE_MS window. Falls back to the most
 * recent fix if the whole window is stale (nothing better available).
 *
 * Pure and dependency-free so it can be unit-tested without pulling in the
 * shared package (which the mobile Jest config can't resolve yet — see
 * mobile/jest.config.js).
 */
export function pickBestFix(
  buffer: readonly { pos: GeoPosition; receivedAt: number }[],
  now: number,
  maxAgeMs: number = FIX_MAX_AGE_MS,
): GeoPosition | null {
  if (buffer.length === 0) return null;
  const fresh = buffer.filter((f) => now - f.receivedAt <= maxAgeMs);
  const pool = fresh.length > 0 ? fresh : buffer;
  let best = pool[0]!;
  for (const candidate of pool) {
    const bestAcc = best.pos.coords.accuracy ?? Number.POSITIVE_INFINITY;
    const candAcc = candidate.pos.coords.accuracy ?? Number.POSITIVE_INFINITY;
    if (candAcc < bestAcc) best = candidate;
  }
  return best.pos;
}
