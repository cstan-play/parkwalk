/**
 * React orchestrator for the digital companion.
 *
 * Composes the three pure-function modules:
 *   policy.step()   → where the dog wants to go (target offset)
 *   leash.step()    → spring-damper integration of the dog's position
 *   direction.snap() → screen-frame sprite for the dog's current motion
 *
 * Continuous state (position, velocity, policy mode) lives in a ref and is
 * advanced every animation frame. React state is only updated at
 * `positionUpdateHz` so re-renders stay cheap; sprite changes are pushed
 * immediately when they happen.
 */

import { useEffect, useRef, useState } from 'react';

import { useMovementDetection } from '@/hooks/useMovementDetection';
import type { LatLng } from '@/util/geo';

import {
  DEFAULT_POLICY_PARAMS,
  createInitialPolicyState,
  stepPolicy,
  type PolicyParams,
  type PolicyState,
} from '@/companion/companionPolicy';
import {
  screenBearing,
  snapToSprite,
  type SpriteOrIdle,
} from '@/companion/direction';
import {
  magnitude,
  stepLeash,
  type LeashParams,
  type LeashState,
  type MetersVec,
} from '@/companion/leash';

export const COMPANION_LEASH_PARAMS: LeashParams = {
  baseStiffness: 4,
  damping: 3,
  stiffnessRampFactor: 4,
  leashMaxMeters: 10,
  maxSpeedMps: 4,
  maxAccelMps2: 3,
};

const SNAP_PARAMS = { hysteresisDeg: 5, idleSpeedMps: 0.3 };
const DEFAULT_RENDER_HZ = 30;

export interface UseCompanionOptions {
  enabled: boolean;
  /** Source of truth for the user's current GPS fix. */
  movement: ReturnType<typeof useMovementDetection>;
  /** Reads the live Mapbox camera bearing each frame. */
  getCameraBearing: () => number;
  /** Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
  positionUpdateHz?: number;
}

export interface CompanionRenderState {
  visible: boolean;
  position: LatLng | null;
  sprite: SpriteOrIdle;
}

interface InternalState {
  leash: LeashState;
  policy: PolicyState;
  sprite: SpriteOrIdle;
  lastFrameMs: number;
  lastRenderMs: number;
}

const HIDDEN: CompanionRenderState = { visible: false, position: null, sprite: 'idle' };

export function useCompanion(opts: UseCompanionOptions): CompanionRenderState {
  const { enabled, movement, getCameraBearing } = opts;
  const rng = opts.rng ?? Math.random;
  const renderIntervalMs = 1000 / (opts.positionUpdateHz ?? DEFAULT_RENDER_HZ);

  const stateRef = useRef<InternalState | null>(null);
  const [render, setRender] = useState<CompanionRenderState>(HIDDEN);

  // Refs for values that change frequently but should not retrigger effects.
  const userLocationRef = useRef<LatLng | null>(null);
  userLocationRef.current = movement.latest
    ? {
        latitude: movement.latest.location.latitude,
        longitude: movement.latest.location.longitude,
      }
    : null;
  const getCameraBearingRef = useRef(getCameraBearing);
  getCameraBearingRef.current = getCameraBearing;

  // Despawn when disabled — separate effect so the spawn/RAF effect can stay
  // free of conditional teardown logic.
  useEffect(() => {
    if (enabled) return;
    stateRef.current = null;
    setRender(HIDDEN);
  }, [enabled]);

  // Spawn + RAF loop. Re-runs only when `enabled` flips, so params are read
  // through refs and closures (stable for the lifetime of the loop).
  useEffect(() => {
    if (!enabled) return undefined;

    let rafId: number | null = null;
    const policyParams: PolicyParams = { ...DEFAULT_POLICY_PARAMS, rng };

    const ensureSpawned = (nowMs: number): InternalState | null => {
      if (stateRef.current) return stateRef.current;
      const user = userLocationRef.current;
      if (!user) return null;
      const policy = createInitialPolicyState(rng);
      const dogPos = userPlusPolarOffset(user, policy.angleDeg, policy.distanceMeters);
      const internal: InternalState = {
        leash: { position: dogPos, velocityMps: { east: 0, north: 0 } },
        policy,
        sprite: 'idle',
        lastFrameMs: nowMs,
        lastRenderMs: 0,
      };
      stateRef.current = internal;
      setRender({ visible: true, position: dogPos, sprite: 'idle' });
      return internal;
    };

    const tick = (nowMs: number): void => {
      const internal = ensureSpawned(nowMs);
      const user = userLocationRef.current;
      if (!internal || !user) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const rawDt = (nowMs - internal.lastFrameMs) / 1000;
      // Cap dt so a tab-pause / dropped frames don't trigger a giant
      // single-step that destabilizes the spring integrator.
      const dtSeconds = Math.min(Math.max(rawDt, 0), 1 / 30);
      internal.lastFrameMs = nowMs;

      const policyResult = stepPolicy(
        internal.policy,
        {
          userPosition: user,
          dogPosition: internal.leash.position,
          dtSeconds,
          nowMs,
        },
        policyParams,
      );
      internal.policy = policyResult.state;

      internal.leash = stepLeash(
        internal.leash,
        {
          userPosition: user,
          targetOffsetMeters: policyResult.targetOffsetMeters,
          dtSeconds,
        },
        COMPANION_LEASH_PARAMS,
      );

      const speed = magnitude(internal.leash.velocityMps);
      const bearing = screenBearing(
        internal.leash.velocityMps,
        getCameraBearingRef.current(),
      );
      const nextSprite = snapToSprite(bearing, speed, internal.sprite, SNAP_PARAMS);
      const spriteChanged = nextSprite !== internal.sprite;
      internal.sprite = nextSprite;

      const renderDue = nowMs - internal.lastRenderMs >= renderIntervalMs;
      if (spriteChanged || renderDue) {
        internal.lastRenderMs = nowMs;
        setRender({
          visible: true,
          position: { ...internal.leash.position },
          sprite: nextSprite,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled, rng, renderIntervalMs]);

  return render;
}

function userPlusPolarOffset(user: LatLng, angleDeg: number, distanceMeters: number): LatLng {
  const angleRad = (angleDeg * Math.PI) / 180;
  const offset: MetersVec = {
    east: distanceMeters * Math.sin(angleRad),
    north: distanceMeters * Math.cos(angleRad),
  };
  const cosLat = Math.cos((user.latitude * Math.PI) / 180);
  const cosLatNonZero = cosLat === 0 ? 1 : cosLat;
  return {
    latitude: user.latitude + offset.north / 111_320,
    longitude: user.longitude + offset.east / (111_320 * cosLatNonZero),
  };
}
