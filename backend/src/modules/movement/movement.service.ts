import {
  GPS_MAX_ACCURACY_METERS,
  MAX_WALKING_SPEED_MPS,
  MIN_SAMPLES_FOR_VALIDATION,
  TELEPORT_THRESHOLD_M,
  type MovementFlag,
  type MovementSample,
  type MovementSummary,
  type MovementValidationResult,
} from '@parkwalk/shared';

/**
 * Server-side authoritative movement validation.
 *
 * Two-tier output:
 *
 *   - `reasons: string[]`  — hard rejects. Non-empty => `valid: false` and
 *                            the collect is blocked with 400 `MOVEMENT_INVALID`.
 *   - `flags: MovementFlag[]` — soft signals. They are persisted to
 *                               `collection_log.movement_data.flags` for
 *                               anti-cheat triage but do NOT block the
 *                               collect.
 *
 * Philosophy (see docs/07-MOVEMENT-DETECTION.md):
 * Hard rejects are reserved for behavior that is physically impossible or
 * unambiguously non-walking — teleport across > 50 m, sustained vehicle
 * speed, explicit automotive activity, missing samples. Everything else
 * (low GPS confidence, zero steps on a pocketed phone where iOS has
 * suspended the raw-accelerometer stream, UNKNOWN activity because we
 * haven't wired CMMotionActivity yet, low-but-plausible client score)
 * is logged as a soft flag and accepted. This mirrors Pokémon GO's
 * Adventure Sync model where sensor corroboration is evidence, not a
 * gate, until we ship the native pedometer (CMPedometer / HealthKit).
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
  const flags: MovementFlag[] = [];

  // ── Hard rejects (physical impossibilities + unambiguous vehicle) ────
  //
  // Per docs/07-MOVEMENT-DETECTION.md the hard-reject list is deliberately
  // narrow. Everything else lands in `flags` for anti-cheat triage.

  // (1) No samples: can't spatially/temporally verify the walk at all.
  if (!samples || samples.length === 0) {
    reasons.push('no movement samples provided');
  }

  // (2) Sustained over-walking speed with automotive activity recognition
  //     = the client itself is telling us the user is in a vehicle.
  if (
    summary.averageSpeedMps > MAX_WALKING_SPEED_MPS &&
    summary.dominantActivity === 'AUTOMOTIVE'
  ) {
    reasons.push(
      `sustained average speed ${summary.averageSpeedMps.toFixed(2)} m/s with automotive activity`,
    );
  }

  // (3) Summary timestamp is in the future → either clock skew we can't
  //     reason about or a replay-attack attempt. Cheap to guard against.
  if (Date.parse(summary.generatedAt) > receivedAt.getTime() + 5_000) {
    reasons.push('summary timestamp is in the future');
  }

  // Sample-level hard rejects (teleport, automotive-from-raw-samples).
  if (samples && samples.length >= MIN_SAMPLES_FOR_VALIDATION) {
    const analysis = analyzeSamples(samples);
    reasons.push(...analysis.reasons);
    flags.push(...analysis.flags);
  }

  // ── Soft flags ───────────────────────────────────────────────────────
  // Evidence, not gates. Persisted into collection_log.movement_data.flags.

  if (receivedAt.getTime() - Date.parse(summary.generatedAt) > MAX_SUMMARY_AGE_MS) {
    flags.push('STALE_SUMMARY');
  }
  if (summary.averageAccuracyMeters > GPS_MAX_ACCURACY_METERS) {
    flags.push('LOW_GPS_ACCURACY');
  }
  if (summary.validationScore < MIN_VALIDATION_SCORE) {
    flags.push('LOW_CLIENT_SCORE');
  }
  if (summary.state !== 'WALKING_VALID') {
    flags.push('CLIENT_STATE_NOT_WALKING');
  }
  if (summary.averageSpeedMps > 0.4 && (summary.stepRateHz ?? 0) < 0.3) {
    flags.push('NO_STEPS_DURING_MOVEMENT');
  }
  if (summary.dominantActivity === undefined || summary.dominantActivity === 'UNKNOWN') {
    flags.push('UNKNOWN_ACTIVITY');
  }

  const valid = reasons.length === 0;
  // Clamp to [0.5, 1] on accept so a legitimate pocketed walk with a
  // cold-cache client score (e.g. 0.45 because activity=UNKNOWN) still
  // satisfies any downstream min-score assertions.
  const score = valid ? Math.max(0.5, Math.min(1, summary.validationScore)) : 0;
  const state = valid
    ? 'WALKING_VALID'
    : summary.state === 'WALKING_VALID'
      ? 'SUSPICIOUS'
      : summary.state;

  return { valid, state, score, reasons, flags };
}

interface SampleAnalysis {
  reasons: string[];
  flags: MovementFlag[];
}

function analyzeSamples(samples: MovementSample[]): SampleAnalysis {
  const reasons: string[] = [];
  const flags: MovementFlag[] = [];

  const sorted = [...samples].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  let stepDeltaSum = 0;
  let stepSampleCount = 0;
  let totalAccel = 0;
  let accelSamples = 0;
  let teleported = false;
  let automotiveHits = 0;
  let cyclingHits = 0;

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
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
    if (s.activity === 'AUTOMOTIVE') automotiveHits++;
    if (s.activity === 'CYCLING') cyclingHits++;

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

  // Hard rejects: teleport + sustained automotive from raw activity.
  if (teleported) reasons.push('teleport detected between samples');
  if (automotiveHits / sorted.length > 0.3) {
    reasons.push('activity recognition reports automotive');
  }

  // Soft flags: cycling (plausible slow commute, not blocking) and the
  // classic "flat accelerometer + GPS moves" spoof signature — logged
  // but not blocking, because iOS legitimately suspends the raw
  // accelerometer stream for pocketed walks and would otherwise false-
  // positive here. Graduates to a hard reject once CMPedometer is wired
  // (see docs/13-BOOTSTRAP-IOS.md Alpha P0).
  if (cyclingHits / sorted.length > 0.3) {
    flags.push('UNKNOWN_ACTIVITY');
  }

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
      flags.push('FLAT_ACCELEROMETER_WITH_GPS');
    }
  }

  return { reasons, flags };
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
