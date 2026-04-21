import {
  GPS_MAX_ACCURACY_METERS,
  MAX_WALKING_SPEED_MPS,
  MOVEMENT_WINDOW_SECONDS,
  type MovementSample,
  type MovementState,
  type MovementSummary,
} from '@parkwalk/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createProductionSensorSource,
  type SensorSource,
} from '@/sensors/productionSource';

export interface UseMovementDetectionOptions {
  sensorSource?: SensorSource;
  windowSeconds?: number;
  enabled?: boolean;
}

export interface MovementDetectionResult {
  state: MovementState;
  summary: MovementSummary | null;
  samples: MovementSample[];
  latest: MovementSample | null;
}

/**
 * Consumes GPS + accelerometer + activity recognition streams and classifies
 * the user's movement in a rolling window. The client classification is
 * ADVISORY — the server re-runs validation on /entities/collect and is the
 * authority. Keeping the hook tiny and injectable is deliberate so tests can
 * feed fixtures from the shared package.
 */
export function useMovementDetection(
  opts: UseMovementDetectionOptions = {},
): MovementDetectionResult {
  const { windowSeconds = MOVEMENT_WINDOW_SECONDS, enabled = true } = opts;

  const sensors = useMemo(() => opts.sensorSource ?? createProductionSensorSource(), [opts.sensorSource]);
  const samplesRef = useRef<MovementSample[]>([]);
  const [result, setResult] = useState<MovementDetectionResult>({
    state: 'UNKNOWN',
    summary: null,
    samples: [],
    latest: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const unsubscribe = sensors.subscribe((sample) => {
      const now = Date.now();
      const keepAfter = now - windowSeconds * 1000;
      const next = [
        ...samplesRef.current.filter((s) => Date.parse(s.timestamp) >= keepAfter),
        sample,
      ];
      samplesRef.current = next;
      const summary = summarize(next, windowSeconds);
      setResult({
        state: summary.state,
        summary,
        samples: next,
        latest: sample,
      });
    });

    return () => {
      unsubscribe();
      samplesRef.current = [];
    };
  }, [sensors, windowSeconds, enabled]);

  return result;
}

export function summarize(
  samples: MovementSample[],
  windowSeconds: number,
): MovementSummary {
  if (samples.length === 0) {
    return {
      windowSeconds,
      sampleCount: 0,
      state: 'UNKNOWN',
      averageSpeedMps: 0,
      maxSpeedMps: 0,
      averageAccuracyMeters: 0,
      stepRateHz: 0,
      dominantActivity: 'UNKNOWN',
      validationScore: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  let totalSpeed = 0;
  let speedSamples = 0;
  let maxSpeed = 0;
  let totalAccuracy = 0;
  let accuracySamples = 0;
  let totalSteps = 0;
  const activityCounts = new Map<string, number>();

  for (const s of samples) {
    if (s.speedMps !== null && s.speedMps !== undefined) {
      totalSpeed += s.speedMps;
      speedSamples++;
      if (s.speedMps > maxSpeed) maxSpeed = s.speedMps;
    }
    if (typeof s.location.accuracy === 'number') {
      totalAccuracy += s.location.accuracy;
      accuracySamples++;
    }
    if (typeof s.stepCountDelta === 'number') totalSteps += s.stepCountDelta;
    if (s.activity) {
      activityCounts.set(s.activity, (activityCounts.get(s.activity) ?? 0) + 1);
    }
  }

  const avgSpeed = speedSamples ? totalSpeed / speedSamples : 0;
  const avgAccuracy = accuracySamples ? totalAccuracy / accuracySamples : 0;
  const stepRateHz = totalSteps / Math.max(1, windowSeconds);
  const dominantActivity = dominantKey(activityCounts) as MovementSummary['dominantActivity'];
  const state = classify({ avgSpeed, maxSpeed, avgAccuracy, stepRateHz, dominantActivity });

  const validationScore = computeScore({
    state,
    maxSpeed,
    avgAccuracy,
    stepRateHz,
    dominantActivity,
  });

  return {
    windowSeconds,
    sampleCount: samples.length,
    state,
    averageSpeedMps: avgSpeed,
    maxSpeedMps: maxSpeed,
    averageAccuracyMeters: avgAccuracy,
    stepRateHz,
    dominantActivity,
    validationScore,
    generatedAt: new Date().toISOString(),
  };
}

function dominantKey(counts: Map<string, number>): string {
  let best = 'UNKNOWN';
  let bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function classify(input: {
  avgSpeed: number;
  maxSpeed: number;
  avgAccuracy: number;
  stepRateHz: number;
  dominantActivity: MovementSummary['dominantActivity'];
}): MovementState {
  const { avgSpeed, maxSpeed, avgAccuracy, stepRateHz, dominantActivity } = input;
  if (avgAccuracy > GPS_MAX_ACCURACY_METERS) return 'SUSPICIOUS';
  if (maxSpeed > MAX_WALKING_SPEED_MPS * 1.4) return 'VEHICLE_SUSPECTED';
  if (dominantActivity === 'AUTOMOTIVE') return 'VEHICLE_SUSPECTED';
  if (dominantActivity === 'CYCLING') return 'BIKE_SUSPECTED';
  if (avgSpeed < 0.2 && stepRateHz < 0.3) return 'STATIONARY';
  if (avgSpeed <= MAX_WALKING_SPEED_MPS && stepRateHz >= 1.0) return 'WALKING_VALID';
  if (avgSpeed > MAX_WALKING_SPEED_MPS) return 'RUNNING';
  return 'UNKNOWN';
}

function computeScore(input: {
  state: MovementState;
  maxSpeed: number;
  avgAccuracy: number;
  stepRateHz: number;
  dominantActivity: MovementSummary['dominantActivity'];
}): number {
  if (input.state !== 'WALKING_VALID') return 0;
  const speedScore = 1 - input.maxSpeed / (MAX_WALKING_SPEED_MPS * 1.5);
  const accuracyScore = 1 - input.avgAccuracy / GPS_MAX_ACCURACY_METERS;
  const stepScore = Math.min(1, input.stepRateHz / 2);
  const activityScore = input.dominantActivity === 'WALKING' ? 1 : 0.5;
  return Math.max(
    0,
    Math.min(1, 0.35 * speedScore + 0.2 * accuracyScore + 0.25 * stepScore + 0.2 * activityScore),
  );
}
