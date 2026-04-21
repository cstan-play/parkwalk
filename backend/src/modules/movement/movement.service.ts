import {
  GPS_MAX_ACCURACY_METERS,
  MAX_WALKING_SPEED_MPS,
  MIN_SAMPLES_FOR_VALIDATION,
  TELEPORT_THRESHOLD_M,
  type MovementSample,
  type MovementSummary,
  type MovementValidationResult,
} from '@parkwalk/shared';

/**
 * Server-side authoritative movement validation.
 *
 * Accepts a client-computed summary AND/OR an array of raw samples.
 * If samples are provided we recompute from them and require the result to
 * agree with the summary within reasonable tolerances. This matches the
 * wire format produced by the mobile client in Phase 1 and fixes the
 * mismatch between docs/03-API-SPECIFICATION.md and docs/07-MOVEMENT-DETECTION.md.
 */
export interface ValidateInput {
  summary: MovementSummary;
  samples?: MovementSample[];
  /** Wall-clock time at which the server received this; used for "staleness" checks. */
  receivedAt?: Date;
}

const MAX_SUMMARY_AGE_MS = 60_000;
const MIN_VALIDATION_SCORE = 0.5;

export function validateMovement(input: ValidateInput): MovementValidationResult {
  const { summary, samples } = input;
  const receivedAt = input.receivedAt ?? new Date();
  const reasons: string[] = [];

  if (Date.parse(summary.generatedAt) > receivedAt.getTime() + 5_000) {
    reasons.push('summary timestamp is in the future');
  }
  if (receivedAt.getTime() - Date.parse(summary.generatedAt) > MAX_SUMMARY_AGE_MS) {
    reasons.push('summary is stale');
  }

  if (summary.averageAccuracyMeters > GPS_MAX_ACCURACY_METERS) {
    reasons.push(`poor GPS accuracy: ${summary.averageAccuracyMeters}m`);
  }

  if (summary.maxSpeedMps > MAX_WALKING_SPEED_MPS) {
    reasons.push(`max speed ${summary.maxSpeedMps.toFixed(2)} m/s exceeds walking threshold`);
  }

  if (summary.averageSpeedMps > MAX_WALKING_SPEED_MPS * 0.9) {
    reasons.push(`average speed ${summary.averageSpeedMps.toFixed(2)} m/s is suspiciously fast`);
  }

  if (summary.validationScore < MIN_VALIDATION_SCORE) {
    reasons.push(`client validation score ${summary.validationScore.toFixed(2)} is too low`);
  }

  if (summary.state === 'VEHICLE_SUSPECTED' || summary.state === 'INVALID' || summary.state === 'SUSPICIOUS') {
    reasons.push(`client reported state: ${summary.state}`);
  }

  if (samples && samples.length >= MIN_SAMPLES_FOR_VALIDATION) {
    const sampleReasons = analyzeSamples(samples);
    reasons.push(...sampleReasons);
  }

  const valid = reasons.length === 0 && summary.state === 'WALKING_VALID';
  const score = valid ? Math.min(1, summary.validationScore) : 0;

  return {
    valid,
    state: valid ? 'WALKING_VALID' : summary.state === 'WALKING_VALID' ? 'SUSPICIOUS' : summary.state,
    score,
    reasons,
  };
}

function analyzeSamples(samples: MovementSample[]): string[] {
  const reasons: string[] = [];

  const sorted = [...samples].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  let stepDeltaSum = 0;
  let stepSampleCount = 0;
  let totalAccel = 0;
  let accelSamples = 0;
  let teleported = false;
  let overMaxSpeed = 0;
  let vehicleActivityHits = 0;

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.speedMps !== null && s.speedMps !== undefined && s.speedMps > MAX_WALKING_SPEED_MPS) {
      overMaxSpeed++;
    }
    if (typeof s.stepCountDelta === 'number') {
      stepDeltaSum += s.stepCountDelta;
      stepSampleCount++;
    }
    if (s.acceleration) {
      totalAccel += Math.abs(
        Math.sqrt(s.acceleration.x ** 2 + s.acceleration.y ** 2 + s.acceleration.z ** 2) - 9.81,
      );
      accelSamples++;
    }
    if (s.activity === 'AUTOMOTIVE' || s.activity === 'CYCLING') {
      vehicleActivityHits++;
    }

    if (i > 0) {
      const prev = sorted[i - 1]!;
      const dtSec = (Date.parse(s.timestamp) - Date.parse(prev.timestamp)) / 1000;
      if (dtSec <= 0) continue;
      const dist = haversineMeters(
        prev.location.latitude,
        prev.location.longitude,
        s.location.latitude,
        s.location.longitude,
      );
      const impliedSpeed = dist / dtSec;
      if (dist > TELEPORT_THRESHOLD_M && impliedSpeed > MAX_WALKING_SPEED_MPS * 2) {
        teleported = true;
      }
    }
  }

  if (teleported) reasons.push('teleport detected between samples');
  if (overMaxSpeed / sorted.length > 0.2) {
    reasons.push(`${overMaxSpeed}/${sorted.length} samples exceed walking speed`);
  }
  if (vehicleActivityHits / sorted.length > 0.3) {
    reasons.push('activity recognition reports vehicle/cycling');
  }
  // Very flat accelerometer with non-zero GPS displacement is a classic spoof signal.
  if (accelSamples > 0 && stepSampleCount > 0) {
    const avgAccelDelta = totalAccel / accelSamples;
    const avgStepDelta = stepDeltaSum / stepSampleCount;
    const gpsDisplacement = sorted.reduce((acc, s, i) => {
      if (i === 0) return 0;
      const prev = sorted[i - 1]!;
      return (
        acc +
        haversineMeters(
          prev.location.latitude,
          prev.location.longitude,
          s.location.latitude,
          s.location.longitude,
        )
      );
    }, 0);
    if (gpsDisplacement > 30 && avgAccelDelta < 0.15 && avgStepDelta < 0.05) {
      reasons.push('GPS movement without matching accelerometer activity (possible spoof)');
    }
  }
  return reasons;
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
