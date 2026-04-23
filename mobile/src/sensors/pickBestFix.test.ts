import { pickBestFix } from './pickBestFix';
import type { GeoPosition } from 'react-native-geolocation-service';

function fix(accuracy: number): GeoPosition {
  return {
    coords: {
      latitude: 55.676,
      longitude: 12.568,
      accuracy,
      altitude: 0,
      heading: 0,
      speed: 0,
      altitudeAccuracy: 0,
    },
    timestamp: Date.now(),
    mocked: false,
    provider: 'gps',
  } as unknown as GeoPosition;
}

describe('pickBestFix', () => {
  it('returns null for an empty buffer', () => {
    expect(pickBestFix([], 1_000)).toBeNull();
  });

  it('selects the lowest-accuracy (i.e. most accurate) fix in the fresh window', () => {
    const now = 10_000;
    const best = pickBestFix(
      [
        { pos: fix(40), receivedAt: now - 4_000 },
        { pos: fix(8), receivedAt: now - 3_000 }, // winner: ±8 m
        { pos: fix(22), receivedAt: now - 1_000 },
      ],
      now,
    );
    expect(best?.coords.accuracy).toBe(8);
  });

  it('ignores stale fixes when any fresh fix exists', () => {
    const now = 20_000;
    const best = pickBestFix(
      [
        { pos: fix(5), receivedAt: now - 30_000 }, // stale, even though most accurate
        { pos: fix(25), receivedAt: now - 2_000 },
      ],
      now,
    );
    expect(best?.coords.accuracy).toBe(25);
  });

  it('falls back to the full buffer when every fix is stale', () => {
    const now = 100_000;
    const best = pickBestFix(
      [
        { pos: fix(20), receivedAt: now - 30_000 },
        { pos: fix(10), receivedAt: now - 60_000 }, // best of a bad lot
        { pos: fix(40), receivedAt: now - 15_000 },
      ],
      now,
    );
    expect(best?.coords.accuracy).toBe(10);
  });

  it('treats undefined accuracy as +Infinity (so it loses to any numeric accuracy)', () => {
    const now = 5_000;
    const posNoAccuracy = fix(0);
    (posNoAccuracy.coords as unknown as { accuracy: number | null }).accuracy = null;
    const best = pickBestFix(
      [
        { pos: posNoAccuracy, receivedAt: now - 1_000 },
        { pos: fix(40), receivedAt: now - 500 },
      ],
      now,
    );
    expect(best?.coords.accuracy).toBe(40);
  });
});
