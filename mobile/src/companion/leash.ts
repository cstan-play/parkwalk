/**
 * Spring-damper "leash" that pulls the digital companion toward a target
 * offset relative to the user. World-frame physics, integrated each tick.
 *
 * Stiffness ramps with tether distance so the leash limit is enforced by
 * physics rather than a state branch — past ~70 % of `leashMaxMeters` the
 * spring stiffens and the dog naturally curves back instead of escaping.
 */

import type { LatLng } from '@/util/geo';

export interface MetersVec {
  east: number;
  north: number;
}

export interface LeashState {
  position: LatLng;
  velocityMps: MetersVec;
}

export interface LeashParams {
  /** Spring stiffness at zero tether distance (N/m, mass = 1). */
  baseStiffness: number;
  /** Velocity damping coefficient (N·s/m). */
  damping: number;
  /** Multiplier added to stiffness at full leash. Final k = base * (1 + factor). */
  stiffnessRampFactor: number;
  /** Maximum allowed tether distance in meters. */
  leashMaxMeters: number;
  /** Hard cap on companion world speed. */
  maxSpeedMps: number;
  /** Hard cap on companion acceleration magnitude. */
  maxAccelMps2: number;
}

export interface LeashStepInput {
  userPosition: LatLng;
  /** Target position expressed as (east, north) meters from `userPosition`. */
  targetOffsetMeters: MetersVec;
  dtSeconds: number;
}

const METERS_PER_DEGREE_LAT = 111_320;

export function stepLeash(
  state: LeashState,
  input: LeashStepInput,
  params: LeashParams,
): LeashState {
  if (input.dtSeconds <= 0) return state;

  const { userPosition, targetOffsetMeters, dtSeconds } = input;
  const dogOffset = latLngDeltaToMeters(
    state.position.latitude - userPosition.latitude,
    state.position.longitude - userPosition.longitude,
    userPosition.latitude,
  );

  const delta: MetersVec = {
    east: targetOffsetMeters.east - dogOffset.east,
    north: targetOffsetMeters.north - dogOffset.north,
  };

  const tetherDistance = magnitude(dogOffset);
  const k = stiffnessAt(tetherDistance, params);
  const c = params.damping;

  let accel: MetersVec = {
    east: k * delta.east - c * state.velocityMps.east,
    north: k * delta.north - c * state.velocityMps.north,
  };
  accel = clampMagnitude(accel, params.maxAccelMps2);

  let velocity: MetersVec = {
    east: state.velocityMps.east + accel.east * dtSeconds,
    north: state.velocityMps.north + accel.north * dtSeconds,
  };
  velocity = clampMagnitude(velocity, params.maxSpeedMps);

  const cosLat = Math.cos((userPosition.latitude * Math.PI) / 180);
  const cosLatNonZero = cosLat === 0 ? 1 : cosLat;
  const newPosition: LatLng = {
    latitude:
      state.position.latitude + (velocity.north * dtSeconds) / METERS_PER_DEGREE_LAT,
    longitude:
      state.position.longitude +
      (velocity.east * dtSeconds) / (METERS_PER_DEGREE_LAT * cosLatNonZero),
  };

  return clampToLeash(newPosition, velocity, userPosition, params.leashMaxMeters);
}

/**
 * Hard leash limit. If the dog stepped past `leashMaxMeters` from the user,
 * pull it back onto the boundary and remove the outward-radial component of
 * its velocity. Tangential motion along the leash is preserved, so a dog
 * circling the user at full leash glides smoothly instead of stopping dead.
 */
function clampToLeash(
  position: LatLng,
  velocity: MetersVec,
  userPosition: LatLng,
  leashMaxMeters: number,
): LeashState {
  const offset = latLngDeltaToMeters(
    position.latitude - userPosition.latitude,
    position.longitude - userPosition.longitude,
    userPosition.latitude,
  );
  const dist = magnitude(offset);
  if (dist <= leashMaxMeters || dist === 0) {
    return { position, velocityMps: velocity };
  }

  const scale = leashMaxMeters / dist;
  const clampedOffset: MetersVec = {
    east: offset.east * scale,
    north: offset.north * scale,
  };
  const cosLat = Math.cos((userPosition.latitude * Math.PI) / 180);
  const cosLatNonZero = cosLat === 0 ? 1 : cosLat;
  const clampedPosition: LatLng = {
    latitude: userPosition.latitude + clampedOffset.north / METERS_PER_DEGREE_LAT,
    longitude:
      userPosition.longitude + clampedOffset.east / (METERS_PER_DEGREE_LAT * cosLatNonZero),
  };

  const radialUnit: MetersVec = { east: offset.east / dist, north: offset.north / dist };
  const radialSpeed = velocity.east * radialUnit.east + velocity.north * radialUnit.north;
  const tangentialVelocity: MetersVec =
    radialSpeed > 0
      ? {
          east: velocity.east - radialSpeed * radialUnit.east,
          north: velocity.north - radialSpeed * radialUnit.north,
        }
      : velocity;

  return { position: clampedPosition, velocityMps: tangentialVelocity };
}

export function stiffnessAt(tetherDistanceMeters: number, params: LeashParams): number {
  const t = clamp01(tetherDistanceMeters / params.leashMaxMeters);
  // smoothstep ramps from 0 at zero tether to 1 at full leash.
  const ramp = t * t * (3 - 2 * t);
  return params.baseStiffness * (1 + params.stiffnessRampFactor * ramp);
}

export function latLngDeltaToMeters(
  deltaLat: number,
  deltaLng: number,
  refLat: number,
): MetersVec {
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  return {
    north: deltaLat * METERS_PER_DEGREE_LAT,
    east: deltaLng * METERS_PER_DEGREE_LAT * cosLat,
  };
}

export function magnitude(v: MetersVec): number {
  return Math.hypot(v.east, v.north);
}

function clampMagnitude(v: MetersVec, maxMagnitude: number): MetersVec {
  const m = magnitude(v);
  if (m <= maxMagnitude || m === 0) return v;
  const scale = maxMagnitude / m;
  return { east: v.east * scale, north: v.north * scale };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
