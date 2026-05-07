import type { LatLng } from '@/util/geo';

import {
  latLngDeltaToMeters,
  magnitude,
  stepLeash,
  stiffnessAt,
  type LeashParams,
  type LeashState,
} from './leash';

const DEFAULT_PARAMS: LeashParams = {
  baseStiffness: 4,
  damping: 3,
  stiffnessRampFactor: 4,
  leashMaxMeters: 10,
  maxSpeedMps: 4,
  maxAccelMps2: 3,
};

const REF_USER: LatLng = { latitude: 37.7749, longitude: -122.4194 };

function offsetUser(meters: { east?: number; north?: number }): LatLng {
  // Shift the reference user by a known number of meters so we can build
  // dog start positions relative to the user without hand-rolling lat/lng math
  // in every test.
  const east = meters.east ?? 0;
  const north = meters.north ?? 0;
  const cosLat = Math.cos((REF_USER.latitude * Math.PI) / 180);
  return {
    latitude: REF_USER.latitude + north / 111_320,
    longitude: REF_USER.longitude + east / (111_320 * cosLat),
  };
}

function simulate(
  initial: LeashState,
  userAt: (tSeconds: number) => LatLng,
  targetOffset: { east: number; north: number },
  durationSeconds: number,
  dt = 1 / 60,
): { final: LeashState; trace: LeashState[] } {
  let state = initial;
  const trace: LeashState[] = [state];
  for (let t = 0; t < durationSeconds; t += dt) {
    state = stepLeash(
      state,
      { userPosition: userAt(t), targetOffsetMeters: targetOffset, dtSeconds: dt },
      DEFAULT_PARAMS,
    );
    trace.push(state);
  }
  return { final: state, trace };
}

describe('latLngDeltaToMeters', () => {
  test('1 degree of latitude is ~111 km north', () => {
    const m = latLngDeltaToMeters(1, 0, 0);
    expect(m.north).toBeCloseTo(111_320, -2);
    expect(m.east).toBeCloseTo(0, 5);
  });

  test('longitude scale shrinks with latitude (cos(60°) = 0.5)', () => {
    const equator = latLngDeltaToMeters(0, 1, 0);
    const sixty = latLngDeltaToMeters(0, 1, 60);
    expect(sixty.east / equator.east).toBeCloseTo(0.5, 3);
  });
});

describe('stiffnessAt', () => {
  test('returns baseStiffness at zero tether', () => {
    expect(stiffnessAt(0, DEFAULT_PARAMS)).toBeCloseTo(DEFAULT_PARAMS.baseStiffness, 6);
  });

  test('returns base * (1 + ramp) at full leash', () => {
    const k = stiffnessAt(DEFAULT_PARAMS.leashMaxMeters, DEFAULT_PARAMS);
    const expected = DEFAULT_PARAMS.baseStiffness * (1 + DEFAULT_PARAMS.stiffnessRampFactor);
    expect(k).toBeCloseTo(expected, 6);
  });

  test('saturates above full leash (does not blow up)', () => {
    const k = stiffnessAt(DEFAULT_PARAMS.leashMaxMeters * 5, DEFAULT_PARAMS);
    const expected = DEFAULT_PARAMS.baseStiffness * (1 + DEFAULT_PARAMS.stiffnessRampFactor);
    expect(k).toBeCloseTo(expected, 6);
  });

  test('grows monotonically across the leash range', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 12; d += 0.5) {
      const k = stiffnessAt(d, DEFAULT_PARAMS);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });
});

describe('stepLeash', () => {
  test('dog already at target with zero velocity stays put', () => {
    const dogStart = offsetUser({ east: 3, north: 0 });
    const initial: LeashState = {
      position: dogStart,
      velocityMps: { east: 0, north: 0 },
    };
    const { final } = simulate(initial, () => REF_USER, { east: 3, north: 0 }, 2);
    expect(final.position.latitude).toBeCloseTo(dogStart.latitude, 8);
    expect(final.position.longitude).toBeCloseTo(dogStart.longitude, 8);
    expect(magnitude(final.velocityMps)).toBeLessThan(0.01);
  });

  test('dt = 0 returns state unchanged', () => {
    const initial: LeashState = {
      position: offsetUser({ east: 5, north: 5 }),
      velocityMps: { east: 1, north: 0 },
    };
    const next = stepLeash(
      initial,
      { userPosition: REF_USER, targetOffsetMeters: { east: 3, north: 0 }, dtSeconds: 0 },
      DEFAULT_PARAMS,
    );
    expect(next).toBe(initial);
  });

  test('stationary user — dog converges to target offset', () => {
    const initial: LeashState = {
      position: REF_USER,
      velocityMps: { east: 0, north: 0 },
    };
    // 6 s of simulation gives the slightly-under-damped spring time to ring
    // out — position settles fast, velocity tail decays a bit slower.
    const { final } = simulate(initial, () => REF_USER, { east: 3, north: 0 }, 6);
    const offsetFromUser = latLngDeltaToMeters(
      final.position.latitude - REF_USER.latitude,
      final.position.longitude - REF_USER.longitude,
      REF_USER.latitude,
    );
    expect(offsetFromUser.east).toBeCloseTo(3, 1);
    expect(offsetFromUser.north).toBeCloseTo(0, 1);
    expect(magnitude(final.velocityMps)).toBeLessThan(0.05);
  });

  test('walking user — dog matches user speed in steady state', () => {
    const userSpeedMps = 1.4;
    // User walks east at 1.4 m/s.
    const userAt = (t: number): LatLng => offsetUser({ east: userSpeedMps * t });
    // Target stays 3m east of user (i.e., dog is 3m ahead, like leading).
    const initial: LeashState = {
      position: offsetUser({ east: 3 }),
      velocityMps: { east: 0, north: 0 },
    };
    const { final } = simulate(initial, userAt, { east: 3, north: 0 }, 8);
    // After several seconds of damped following, the dog's world velocity
    // should be close to the user's: it is walking alongside, not falling
    // behind or running off.
    expect(final.velocityMps.east).toBeGreaterThan(userSpeedMps * 0.85);
    expect(final.velocityMps.east).toBeLessThan(userSpeedMps * 1.15);
    expect(Math.abs(final.velocityMps.north)).toBeLessThan(0.05);
  });

  test('max-speed clamp prevents teleport from a far-away spawn', () => {
    // Spawn dog 200 m from target. Spring force will be huge; we expect the
    // velocity-magnitude clamp to keep it within maxSpeedMps regardless.
    const initial: LeashState = {
      position: offsetUser({ east: 200 }),
      velocityMps: { east: 0, north: 0 },
    };
    const { trace } = simulate(initial, () => REF_USER, { east: 0, north: 0 }, 5);
    for (const s of trace) {
      expect(magnitude(s.velocityMps)).toBeLessThanOrEqual(DEFAULT_PARAMS.maxSpeedMps + 1e-6);
    }
  });

  test('max-accel clamp limits per-step velocity change', () => {
    const initial: LeashState = {
      position: offsetUser({ east: 200 }),
      velocityMps: { east: 0, north: 0 },
    };
    const dt = 1 / 60;
    let prev = initial;
    for (let i = 0; i < 600; i++) {
      const next = stepLeash(
        prev,
        { userPosition: REF_USER, targetOffsetMeters: { east: 0, north: 0 }, dtSeconds: dt },
        DEFAULT_PARAMS,
      );
      const dv = magnitude({
        east: next.velocityMps.east - prev.velocityMps.east,
        north: next.velocityMps.north - prev.velocityMps.north,
      });
      // Accel cap is 3 m/s²; per-step Δv should be ≤ 3 * dt + epsilon.
      expect(dv).toBeLessThanOrEqual(DEFAULT_PARAMS.maxAccelMps2 * dt + 1e-9);
      prev = next;
    }
  });

  test('hard leash clamp — dog never exceeds leashMax even with extreme target', () => {
    // Target 50 m east of user — far past leashMax. The hard clamp must
    // hold the dog at exactly leashMax regardless of how hard the spring
    // pulls. This is the safety net for jittery GPS or runaway policies.
    const initial: LeashState = {
      position: REF_USER,
      velocityMps: { east: 0, north: 0 },
    };
    const { trace, final } = simulate(initial, () => REF_USER, { east: 50, north: 0 }, 30);
    for (const s of trace) {
      const off = latLngDeltaToMeters(
        s.position.latitude - REF_USER.latitude,
        s.position.longitude - REF_USER.longitude,
        REF_USER.latitude,
      );
      // Allow microscopic overshoot from the per-step lat/lng round-trip.
      expect(magnitude(off)).toBeLessThanOrEqual(DEFAULT_PARAMS.leashMaxMeters + 1e-3);
    }
    const finalOffset = latLngDeltaToMeters(
      final.position.latitude - REF_USER.latitude,
      final.position.longitude - REF_USER.longitude,
      REF_USER.latitude,
    );
    // Steady state pinned at the leash boundary in the direction of the target.
    expect(magnitude(finalOffset)).toBeCloseTo(DEFAULT_PARAMS.leashMaxMeters, 2);
    expect(finalOffset.east).toBeGreaterThan(0);
  });

  test('hard clamp preserves tangential velocity at leash boundary', () => {
    // Dog already at leash boundary, moving tangentially (pure north
    // velocity while offset is to the east). Outward radial velocity is 0.
    // Target tries to pull further out — clamp should keep position pinned
    // while preserving the tangential component of velocity.
    const startOffsetEast = DEFAULT_PARAMS.leashMaxMeters;
    const initial: LeashState = {
      position: offsetUser({ east: startOffsetEast }),
      velocityMps: { east: 0, north: 1.5 },
    };
    const next = stepLeash(
      initial,
      {
        userPosition: REF_USER,
        targetOffsetMeters: { east: 100, north: 0 },
        dtSeconds: 1 / 60,
      },
      DEFAULT_PARAMS,
    );
    // Some northward velocity should remain — the clamp only zeros the
    // outward radial component, not the whole velocity vector.
    expect(next.velocityMps.north).toBeGreaterThan(0.5);
  });
});
