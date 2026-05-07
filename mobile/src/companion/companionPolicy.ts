/**
 * Behavior policy for the digital companion. Owns the polar target offset
 * (where the dog is "trying to go" relative to the user) and the
 * ROAM/LINGER state machine.
 *
 * - ROAM: angle and radial distance drift continuously, so the dog wanders
 *   around the user — front, sides, behind — over time.
 * - LINGER: triggered when the dog has held near the leash boundary for a
 *   while. The target snaps to a world-anchored coordinate so the dog
 *   "stays put and sniffs" while the user catches up. Exits after a random
 *   2–4 s window.
 *
 * The policy is a pure function of state + input, with all randomness fed
 * through an injected RNG so tests are deterministic.
 */

import type { LatLng } from '@/util/geo';

import { latLngDeltaToMeters, magnitude, type MetersVec } from './leash';

export type PolicyMode = 'roam' | 'linger';

export interface RoamState {
  mode: 'roam';
  /** Current polar angle (degrees clockwise from north) of the target around the user. */
  angleDeg: number;
  /** Current polar distance (meters) of the target from the user. */
  distanceMeters: number;
  /**
   * Wall-clock timestamp at which the dog first crossed the linger
   * threshold; null while the dog is comfortably inside the leash.
   */
  nearLeashSinceMs: number | null;
}

export interface LingerState {
  mode: 'linger';
  /** World-anchored target position; held fixed during this episode. */
  anchor: LatLng;
  /** Wall-clock timestamp at which this linger episode ends. */
  endsAtMs: number;
  /** Polar coords to resume from when the episode ends. */
  resumeAngleDeg: number;
  resumeDistanceMeters: number;
}

export type PolicyState = RoamState | LingerState;

export interface PolicyParams {
  leashMaxMeters: number;
  /** Fraction of leashMax above which the dog is considered "near leash". */
  lingerHoldFraction: number;
  /** Continuous time near leash that triggers a LINGER episode. */
  lingerHoldRequiredSeconds: number;
  lingerDurationMinSeconds: number;
  lingerDurationMaxSeconds: number;
  /** Per-second SD of the random walk on the polar angle (degrees). */
  angleDriftDegPerSec: number;
  /** Per-second SD of the random walk on the polar distance (meters). */
  distanceDriftMpsPerSec: number;
  /** Lower bound on polar distance (the dog never sits ON the user). */
  minDistanceMeters: number;
  /** How far inside leashMax the polar distance is capped. */
  maxDistanceMargin: number;
  rng: () => number;
}

export interface PolicyStepInput {
  userPosition: LatLng;
  dogPosition: LatLng;
  dtSeconds: number;
  nowMs: number;
}

export interface PolicyStepResult {
  state: PolicyState;
  targetOffsetMeters: MetersVec;
}

export const DEFAULT_POLICY_PARAMS: Omit<PolicyParams, 'rng'> = {
  leashMaxMeters: 10,
  lingerHoldFraction: 0.85,
  lingerHoldRequiredSeconds: 1,
  lingerDurationMinSeconds: 2,
  lingerDurationMaxSeconds: 4,
  angleDriftDegPerSec: 10,
  distanceDriftMpsPerSec: 1.5,
  minDistanceMeters: 1,
  maxDistanceMargin: 1,
};

export function createInitialPolicyState(rng: () => number): RoamState {
  return {
    mode: 'roam',
    angleDeg: rng() * 360,
    distanceMeters: 3, // start mid-leash so the spring has somewhere to settle
    nearLeashSinceMs: null,
  };
}

export function stepPolicy(
  state: PolicyState,
  input: PolicyStepInput,
  params: PolicyParams,
): PolicyStepResult {
  if (input.dtSeconds <= 0) {
    return { state, targetOffsetMeters: targetOffsetFor(state, input.userPosition) };
  }
  if (state.mode === 'linger') return stepLinger(state, input, params);
  return stepRoam(state, input, params);
}

function stepLinger(
  state: LingerState,
  input: PolicyStepInput,
  params: PolicyParams,
): PolicyStepResult {
  if (input.nowMs >= state.endsAtMs) {
    const resumed: RoamState = {
      mode: 'roam',
      angleDeg: state.resumeAngleDeg,
      distanceMeters: state.resumeDistanceMeters,
      nearLeashSinceMs: null,
    };
    return stepRoam(resumed, input, params);
  }
  return { state, targetOffsetMeters: targetOffsetFor(state, input.userPosition) };
}

function stepRoam(
  state: RoamState,
  input: PolicyStepInput,
  params: PolicyParams,
): PolicyStepResult {
  const sqrtDt = Math.sqrt(input.dtSeconds);
  const dAngle = standardNormal(params.rng) * params.angleDriftDegPerSec * sqrtDt;
  const dDist = standardNormal(params.rng) * params.distanceDriftMpsPerSec * sqrtDt;

  const minDist = params.minDistanceMeters;
  const maxDist = Math.max(minDist, params.leashMaxMeters - params.maxDistanceMargin);
  const angleDeg = normalizeDeg(state.angleDeg + dAngle);
  const distanceMeters = clamp(state.distanceMeters + dDist, minDist, maxDist);

  const candidate: RoamState = {
    mode: 'roam',
    angleDeg,
    distanceMeters,
    nearLeashSinceMs: state.nearLeashSinceMs,
  };
  const targetOffsetMeters = targetOffsetFor(candidate, input.userPosition);

  const tetherMeters = tetherDistance(input.userPosition, input.dogPosition);
  const lingerThresholdMeters = params.lingerHoldFraction * params.leashMaxMeters;

  let nearLeashSinceMs = candidate.nearLeashSinceMs;
  if (tetherMeters >= lingerThresholdMeters) {
    if (nearLeashSinceMs === null) nearLeashSinceMs = input.nowMs;
    if (input.nowMs - nearLeashSinceMs >= params.lingerHoldRequiredSeconds * 1000) {
      const lingerSeconds =
        params.lingerDurationMinSeconds +
        (params.lingerDurationMaxSeconds - params.lingerDurationMinSeconds) * params.rng();
      const anchor = userPlusOffset(input.userPosition, targetOffsetMeters);
      const lingerState: LingerState = {
        mode: 'linger',
        anchor,
        endsAtMs: input.nowMs + lingerSeconds * 1000,
        resumeAngleDeg: angleDeg,
        resumeDistanceMeters: distanceMeters,
      };
      return { state: lingerState, targetOffsetMeters };
    }
  } else {
    nearLeashSinceMs = null;
  }

  return {
    state: { ...candidate, nearLeashSinceMs },
    targetOffsetMeters,
  };
}

function targetOffsetFor(state: PolicyState, userPosition: LatLng): MetersVec {
  if (state.mode === 'linger') {
    return latLngDeltaToMeters(
      state.anchor.latitude - userPosition.latitude,
      state.anchor.longitude - userPosition.longitude,
      userPosition.latitude,
    );
  }
  const angleRad = (state.angleDeg * Math.PI) / 180;
  return {
    east: state.distanceMeters * Math.sin(angleRad),
    north: state.distanceMeters * Math.cos(angleRad),
  };
}

function userPlusOffset(user: LatLng, offset: MetersVec): LatLng {
  const cosLat = Math.cos((user.latitude * Math.PI) / 180);
  const cosLatNonZero = cosLat === 0 ? 1 : cosLat;
  return {
    latitude: user.latitude + offset.north / 111_320,
    longitude: user.longitude + offset.east / (111_320 * cosLatNonZero),
  };
}

function tetherDistance(a: LatLng, b: LatLng): number {
  const offset = latLngDeltaToMeters(
    b.latitude - a.latitude,
    b.longitude - a.longitude,
    a.latitude,
  );
  return magnitude(offset);
}

function standardNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function normalizeDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}
