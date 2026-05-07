import type { LatLng } from '@/util/geo';

import {
  DEFAULT_POLICY_PARAMS,
  createInitialPolicyState,
  stepPolicy,
  type PolicyParams,
  type PolicyState,
} from './companionPolicy';
import { latLngDeltaToMeters, magnitude } from './leash';

const REF_USER: LatLng = { latitude: 37.7749, longitude: -122.4194 };

function offsetUser(meters: { east?: number; north?: number }): LatLng {
  const east = meters.east ?? 0;
  const north = meters.north ?? 0;
  const cosLat = Math.cos((REF_USER.latitude * Math.PI) / 180);
  return {
    latitude: REF_USER.latitude + north / 111_320,
    longitude: REF_USER.longitude + east / (111_320 * cosLat),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function paramsWithRng(rng: () => number, overrides: Partial<PolicyParams> = {}): PolicyParams {
  return { ...DEFAULT_POLICY_PARAMS, rng, ...overrides };
}

describe('createInitialPolicyState', () => {
  test('starts in roam with mid-leash distance and a sane angle', () => {
    const s = createInitialPolicyState(mulberry32(1));
    expect(s.mode).toBe('roam');
    expect(s.distanceMeters).toBeGreaterThan(0);
    expect(s.distanceMeters).toBeLessThan(DEFAULT_POLICY_PARAMS.leashMaxMeters);
    expect(s.angleDeg).toBeGreaterThanOrEqual(0);
    expect(s.angleDeg).toBeLessThan(360);
    expect(s.nearLeashSinceMs).toBeNull();
  });
});

describe('stepPolicy — ROAM drift bounds', () => {
  test('polar distance stays within [min, leashMax - margin] over a long sweep', () => {
    const params = paramsWithRng(mulberry32(42));
    let state: PolicyState = createInitialPolicyState(mulberry32(7));
    const dt = 1 / 60;
    const minD = params.minDistanceMeters;
    const maxD = params.leashMaxMeters - params.maxDistanceMargin;

    for (let i = 0; i < 6000; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: REF_USER, // dog co-located with user → never near leash, never lingers
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
      if (state.mode === 'roam') {
        expect(state.distanceMeters).toBeGreaterThanOrEqual(minD - 1e-9);
        expect(state.distanceMeters).toBeLessThanOrEqual(maxD + 1e-9);
        expect(state.angleDeg).toBeGreaterThanOrEqual(0);
        expect(state.angleDeg).toBeLessThan(360);
      }
    }
  });

  test('polar angle wanders substantially over a long sweep (not stuck)', () => {
    // With angleDriftDegPerSec = 10 (per-second SD), a 5-minute simulation
    // should accumulate large angular displacement even though it is a
    // slow random walk. Cumulative absolute change is the right measure —
    // visited-quadrants depends on the starting angle and is too flaky.
    const params = paramsWithRng(mulberry32(99));
    let state: PolicyState = createInitialPolicyState(mulberry32(99));
    const dt = 1 / 30;
    let cumulativeChangeDeg = 0;
    let prevAngle = state.angleDeg;
    for (let i = 0; i < 9000; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: REF_USER,
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
      if (state.mode === 'roam') {
        const delta = Math.abs(state.angleDeg - prevAngle);
        cumulativeChangeDeg += delta > 180 ? 360 - delta : delta;
        prevAngle = state.angleDeg;
      }
    }
    // Expected accumulated travel ≈ E[|N(0, σ√dt)|] × steps
    //   ≈ 0.8 × 10 × √(1/30) × 9000 ≈ 1300°.
    // Loose lower bound that catches a frozen-angle bug without flaking.
    expect(cumulativeChangeDeg).toBeGreaterThan(500);
  });

  test('dt = 0 returns state unchanged with current target', () => {
    const params = paramsWithRng(mulberry32(1));
    const initial = createInitialPolicyState(mulberry32(1));
    const result = stepPolicy(
      initial,
      { userPosition: REF_USER, dogPosition: REF_USER, dtSeconds: 0, nowMs: 0 },
      params,
    );
    expect(result.state).toBe(initial);
  });
});

describe('stepPolicy — ROAM → LINGER trigger', () => {
  test('does NOT enter linger when dog is well inside the leash', () => {
    const params = paramsWithRng(mulberry32(1));
    let state: PolicyState = createInitialPolicyState(mulberry32(1));
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 2 }), // 2 m tether, well below 8.5 m threshold
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
    }
    expect(state.mode).toBe('roam');
  });

  test('enters linger after sustained near-leash time', () => {
    const params = paramsWithRng(mulberry32(1));
    let state: PolicyState = createInitialPolicyState(mulberry32(1));
    const dt = 1 / 60;
    // Dog held at 9 m → above the 8.5 m threshold (0.85 * 10).
    for (let i = 0; i < 200; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 9 }),
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
      if (state.mode === 'linger') break;
    }
    expect(state.mode).toBe('linger');
  });

  test('linger requires sustained presence — brief excursion does not trigger', () => {
    const params = paramsWithRng(mulberry32(1));
    let state: PolicyState = createInitialPolicyState(mulberry32(1));
    const dt = 1 / 60;
    // 0.5 s above threshold (less than the 1 s requirement), then 5 s under it.
    for (let i = 0; i < 30; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 9 }),
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
    }
    for (let i = 30; i < 330; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 2 }),
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
    }
    expect(state.mode).toBe('roam');
    if (state.mode === 'roam') expect(state.nearLeashSinceMs).toBeNull();
  });
});

describe('stepPolicy — LINGER world-anchor behavior', () => {
  test('target offset stays world-anchored as the user walks past', () => {
    const params = paramsWithRng(mulberry32(1));
    let state: PolicyState = createInitialPolicyState(mulberry32(1));
    const dt = 1 / 60;
    // Force entry into linger.
    for (let i = 0; i < 200; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 9 }),
          dtSeconds: dt,
          nowMs: i * dt * 1000,
        },
        params,
      );
      state = result.state;
      if (state.mode === 'linger') break;
    }
    expect(state.mode).toBe('linger');

    // Now walk the user 5 m east while still in the linger window. The
    // anchor stays fixed in the world, so the target offset measured from
    // the user shifts by exactly -5 m east.
    const beforeOffset = stepPolicy(
      state,
      {
        userPosition: REF_USER,
        dogPosition: offsetUser({ east: 9 }),
        dtSeconds: dt,
        nowMs: 200 * dt * 1000,
      },
      params,
    ).targetOffsetMeters;

    const movedUser = offsetUser({ east: 5 });
    const afterOffset = stepPolicy(
      state,
      {
        userPosition: movedUser,
        dogPosition: offsetUser({ east: 9 }),
        dtSeconds: dt,
        nowMs: 200 * dt * 1000 + 1000,
      },
      params,
    ).targetOffsetMeters;

    expect(afterOffset.east - beforeOffset.east).toBeCloseTo(-5, 0);
    expect(afterOffset.north - beforeOffset.north).toBeCloseTo(0, 0);
  });

  test('linger ends after lingerDuration and returns to roam', () => {
    const params = paramsWithRng(mulberry32(1));
    let state: PolicyState = createInitialPolicyState(mulberry32(1));
    const dt = 1 / 60;
    let nowMs = 0;

    // Enter linger.
    for (let i = 0; i < 200; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 9 }),
          dtSeconds: dt,
          nowMs,
        },
        params,
      );
      state = result.state;
      nowMs += dt * 1000;
      if (state.mode === 'linger') break;
    }
    expect(state.mode).toBe('linger');
    const lingerEnd = state.mode === 'linger' ? state.endsAtMs : 0;

    // Step well past the linger end with the dog now safely inside the leash.
    for (let i = 0; i < 600; i++) {
      const result = stepPolicy(
        state,
        {
          userPosition: REF_USER,
          dogPosition: offsetUser({ east: 1 }),
          dtSeconds: dt,
          nowMs: lingerEnd + 1000 + i * dt * 1000,
        },
        params,
      );
      state = result.state;
    }
    expect(state.mode).toBe('roam');
  });
});

describe('stepPolicy — determinism', () => {
  test('same seed → same trajectory', () => {
    const dt = 1 / 60;
    const trajectoryFor = (seed: number): number[] => {
      const params = paramsWithRng(mulberry32(seed));
      let state: PolicyState = createInitialPolicyState(mulberry32(seed));
      const offsets: number[] = [];
      for (let i = 0; i < 100; i++) {
        const result = stepPolicy(
          state,
          {
            userPosition: REF_USER,
            dogPosition: REF_USER,
            dtSeconds: dt,
            nowMs: i * dt * 1000,
          },
          params,
        );
        state = result.state;
        offsets.push(magnitude(result.targetOffsetMeters));
      }
      return offsets;
    };
    expect(trajectoryFor(123)).toEqual(trajectoryFor(123));
    expect(trajectoryFor(123)).not.toEqual(trajectoryFor(456));
  });
});

describe('targetOffset shape', () => {
  test('roam target offset polar magnitude matches state distance', () => {
    const params = paramsWithRng(mulberry32(1));
    const state: PolicyState = {
      mode: 'roam',
      angleDeg: 37,
      distanceMeters: 4.2,
      nearLeashSinceMs: null,
    };
    const result = stepPolicy(
      state,
      { userPosition: REF_USER, dogPosition: REF_USER, dtSeconds: 0, nowMs: 0 },
      params,
    );
    expect(magnitude(result.targetOffsetMeters)).toBeCloseTo(4.2, 6);
  });

  test('linger target offset equals the meter projection of (anchor - user)', () => {
    const anchor = offsetUser({ east: 6, north: -2 });
    const state: PolicyState = {
      mode: 'linger',
      anchor,
      endsAtMs: 100_000,
      resumeAngleDeg: 0,
      resumeDistanceMeters: 3,
    };
    const params = paramsWithRng(mulberry32(1));
    const result = stepPolicy(
      state,
      { userPosition: REF_USER, dogPosition: REF_USER, dtSeconds: 0, nowMs: 0 },
      params,
    );
    expect(result.targetOffsetMeters.east).toBeCloseTo(6, 1);
    expect(result.targetOffsetMeters.north).toBeCloseTo(-2, 1);
  });
});
