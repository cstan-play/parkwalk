import type { MovementSample } from '@parkwalk/shared';

import { summarize } from './useMovementDetection';

/**
 * These tests cover the classifier contract — they're the source of truth
 * for the anti-cheat design. Breaking any of them likely means we've
 * regressed on either (a) "speed is the primary anti-cheat signal" or
 * (b) "missing secondary signals must not block legitimate walks".
 */

const WINDOW_SECONDS = 30;

function baseSample(overrides: Partial<MovementSample> = {}): MovementSample {
  return {
    timestamp: new Date().toISOString(),
    location: { latitude: 55.66, longitude: 12.59, accuracy: 8 },
    speedMps: 1.3,
    headingDegrees: 90,
    acceleration: { x: 0.1, y: 0.0, z: 9.8 },
    stepCountDelta: 0,
    activity: 'UNKNOWN',
    ...overrides,
  };
}

function series(n: number, overrides: Partial<MovementSample> = {}): MovementSample[] {
  const out: MovementSample[] = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    out.push({
      ...baseSample(overrides),
      timestamp: new Date(t0 + i * 1000).toISOString(),
    });
  }
  return out;
}

describe('summarize (classifier + score)', () => {
  test('empty samples → UNKNOWN with zero score', () => {
    const r = summarize([], WINDOW_SECONDS);
    expect(r.state).toBe('UNKNOWN');
    expect(r.validationScore).toBe(0);
  });

  test('pocketed walk: speed-only (no steps, no activity) clears server threshold', () => {
    // Legitimate walk: phone in pocket, accelerometer stream suspended by iOS,
    // CoreMotion activity not implemented yet. Must pass.
    const r = summarize(series(20, { speedMps: 1.4, stepCountDelta: 0, activity: 'UNKNOWN' }), WINDOW_SECONDS);
    expect(r.state).toBe('WALKING_VALID');
    expect(r.validationScore).toBeGreaterThanOrEqual(0.5);
  });

  test('hand-held walk: speed + steps + activity → high confidence', () => {
    const r = summarize(
      series(20, { speedMps: 1.3, stepCountDelta: 2, activity: 'WALKING' }),
      WINDOW_SECONDS,
    );
    expect(r.state).toBe('WALKING_VALID');
    expect(r.validationScore).toBeGreaterThan(0.7);
    expect(r.stepRateHz).toBeGreaterThan(1);
  });

  test('stationary (both signals quiet) → STATIONARY, not walking', () => {
    const r = summarize(series(20, { speedMps: 0.05, stepCountDelta: 0 }), WINDOW_SECONDS);
    expect(r.state).toBe('STATIONARY');
    expect(r.validationScore).toBe(0);
  });

  test('stationary but stepping (running in place) → WALKING_VALID', () => {
    // Someone doing knee raises at home — generous but acceptable.
    const r = summarize(series(20, { speedMps: 0.05, stepCountDelta: 2 }), WINDOW_SECONDS);
    expect(r.state).toBe('WALKING_VALID');
  });

  test('car speed → VEHICLE_SUSPECTED via max speed gate', () => {
    const mixed = series(20, { speedMps: 1.3 });
    // One burst at car speed is enough — maxSpeed * 1.4 threshold = 3.5 m/s.
    mixed[10]!.speedMps = 8.0;
    const r = summarize(mixed, WINDOW_SECONDS);
    expect(r.state).toBe('VEHICLE_SUSPECTED');
    expect(r.validationScore).toBe(0);
  });

  test('slow-traffic attack (sub-walking speed while in a car) still classifies as WALKING', () => {
    // Known limitation documented in docs/07-MOVEMENT-DETECTION.md: if someone
    // drives at < 3.5 m/s for 30s AND spoofs steps away AND kills activity
    // recognition, we accept. Defense-in-depth (server-side teleport +
    // acceleration-flatness spoof check) catches this in practice.
    const r = summarize(series(20, { speedMps: 1.8, stepCountDelta: 0 }), WINDOW_SECONDS);
    expect(r.state).toBe('WALKING_VALID');
  });

  test('bad GPS (accuracy > 35m) → SUSPICIOUS', () => {
    // Threshold was raised from 20 -> 35 m after first-walk telemetry; see
    // shared/src/constants.ts and docs/07-MOVEMENT-DETECTION.md.
    const r = summarize(
      series(20, { speedMps: 1.3, location: { latitude: 55.66, longitude: 12.59, accuracy: 50 } }),
      WINDOW_SECONDS,
    );
    expect(r.state).toBe('SUSPICIOUS');
  });

  test('cycling activity → BIKE_SUSPECTED even at walking speed', () => {
    const r = summarize(series(20, { speedMps: 1.3, activity: 'CYCLING' }), WINDOW_SECONDS);
    expect(r.state).toBe('BIKE_SUSPECTED');
  });

  test('running speed (> 2.5 m/s) → RUNNING', () => {
    const r = summarize(series(20, { speedMps: 3.0 }), WINDOW_SECONDS);
    expect(r.state).toBe('RUNNING');
  });

  test('low speed AND low steps but not stationary (drifting GPS, 0.3 m/s) → UNKNOWN', () => {
    // Speed above "truly stationary" (0.2) but below walking-by-speed (0.4)
    // and no pedometer data → classifier refuses to guess.
    const r = summarize(series(20, { speedMps: 0.3, stepCountDelta: 0 }), WINDOW_SECONDS);
    expect(r.state).toBe('UNKNOWN');
  });
});
