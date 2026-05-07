/**
 * Direction snapping for the 8-sprite companion.
 *
 * Velocity is computed in world-frame east/north meters (see leash.ts).
 * To pick the sprite the user actually sees, that vector is rotated by the
 * negative of the camera bearing — so when the map is rotated, the dog's
 * sprite still matches its on-screen direction of motion.
 *
 * A small hysteresis margin around each 45° boundary stops the sprite from
 * flickering between two arrows when the angle hovers near a transition.
 *
 * Below `idleSpeedMps` the velocity is treated as noise and the previous
 * sprite is kept (returns 'idle' on the very first call before any sprite
 * is established).
 */

import type { MetersVec } from './leash';

export type SpriteDirection =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';

export type SpriteOrIdle = SpriteDirection | 'idle';

const DIRECTIONS: SpriteDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

export interface SnapParams {
  /** Hysteresis margin in degrees on each side of a sprite boundary. */
  hysteresisDeg: number;
  /** Speed below which velocity is treated as noise. */
  idleSpeedMps: number;
}

/**
 * Convert a world-frame velocity vector and a camera bearing into a screen-
 * frame compass bearing in [0, 360). 0° = "tip points to the top of the
 * screen", 90° = "tip points to the right of the screen", etc.
 *
 * @param velocity world-frame velocity (east/north m/s)
 * @param cameraBearingDeg compass bearing of the camera in degrees clockwise
 *                         from north — same convention as Mapbox `heading`
 */
export function screenBearing(velocity: MetersVec, cameraBearingDeg: number): number {
  // World bearing of the velocity vector (compass, clockwise from north).
  const worldBearing = (Math.atan2(velocity.east, velocity.north) * 180) / Math.PI;
  return normalizeDeg(worldBearing - cameraBearingDeg);
}

/**
 * Snap a screen-frame bearing to one of the 8 cardinal/intercardinal sprite
 * directions, applying hysteresis against the previously displayed sprite.
 *
 * Returns 'idle' if `speedMps < idleSpeedMps` and there is no previous
 * sprite to keep; otherwise returns the held previous sprite.
 */
export function snapToSprite(
  screenBearingDeg: number,
  speedMps: number,
  previous: SpriteOrIdle,
  params: SnapParams,
): SpriteOrIdle {
  if (speedMps < params.idleSpeedMps) {
    return previous === 'idle' ? 'idle' : previous;
  }

  const bearing = normalizeDeg(screenBearingDeg);
  const naive = naiveSnap(bearing);

  if (previous === 'idle' || previous === naive) return naive;

  // Apply hysteresis: only switch off `previous` once we are past the
  // boundary plus the margin. Otherwise hold the previous sprite.
  const previousCenter = directionCenterDeg(previous);
  const distance = shortestArcDeg(bearing, previousCenter);
  if (distance <= 22.5 + params.hysteresisDeg) return previous;

  return naive;
}

function naiveSnap(bearingDeg: number): SpriteDirection {
  const idx = Math.round(bearingDeg / 45) % 8;
  return DIRECTIONS[(idx + 8) % 8]!;
}

function directionCenterDeg(d: SpriteDirection): number {
  return DIRECTIONS.indexOf(d) * 45;
}

function shortestArcDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

function normalizeDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}
