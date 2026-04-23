/**
 * Pedometer for raw 3-axis accelerometer samples (units: m/s^2, including
 * gravity).
 *
 * Algorithm: gravity-compensated peak detection.
 *   1. Running low-pass filter tracks the magnitude of gravity (~9.81 m/s^2).
 *   2. Each sample's dynamic acceleration = |accel| - gravityEstimate.
 *   3. A step is counted on the falling edge after a peak that exceeded
 *      PEAK_THRESHOLD_MPS2, subject to a MIN_STEP_INTERVAL_MS refractory
 *      period (rejects double-triggers at ~4 steps/sec cap).
 *
 * This is intentionally simple and pure — no timers, no I/O — so it can be
 * unit-tested with deterministic fixtures and swapped for a native-module
 * pedometer later (CMPedometer / Android Step Counter) without churn in
 * `productionSource.ts`.
 *
 * Calibration notes:
 *   - Gravity LPF needs ~300-500ms to converge from cold start; during that
 *     window false-positives can fire. Call `reset()` or skip the first
 *     ~20 samples if this matters for your use case.
 *   - PEAK_THRESHOLD_MPS2 = 0.6 is tuned for hand-held walking (arm-swing
 *     peaks at ~0.6-0.9 m/s^2 over gravity). Raise to 1.0-1.5 for pocketed
 *     walking only, or 1.5-2.0 for bag-carried walking only. The default
 *     was lowered from 1.0 -> 0.6 after first-walk telemetry showed
 *     hand-held walks registering zero steps.
 *
 * References:
 *   "A Robust Step Detection Algorithm..." Susi, Renaudin, Lachapelle 2013
 */

export interface StepDetector {
  update(x: number, y: number, z: number, timestampMs: number): boolean;
  reset(): void;
  readonly stepCount: number;
}

export interface StepDetectorOptions {
  /** Low-pass filter rate for gravity estimate (0-1; smaller = slower). */
  gravityAlpha?: number;
  /** Dynamic acceleration peak threshold in m/s^2. */
  peakThresholdMps2?: number;
  /** Minimum time between counted steps (ms) — caps step rate. */
  minStepIntervalMs?: number;
  /** Seed gravity estimate; 9.81 is a sane default for Earth. */
  initialGravity?: number;
}

const DEFAULTS: Required<StepDetectorOptions> = {
  gravityAlpha: 0.1,
  peakThresholdMps2: 0.6,
  minStepIntervalMs: 280,
  initialGravity: 9.81,
};

export function createStepDetector(opts: StepDetectorOptions = {}): StepDetector {
  const cfg = { ...DEFAULTS, ...opts };

  let gravity = cfg.initialGravity;
  let prevDynamic = 0;
  let rising = false;
  let lastStepAt = 0;
  let count = 0;

  return {
    update(x, y, z, timestampMs) {
      const mag = Math.sqrt(x * x + y * y + z * z);
      gravity = (1 - cfg.gravityAlpha) * gravity + cfg.gravityAlpha * mag;
      const dynamic = mag - gravity;

      let stepped = false;
      if (dynamic > prevDynamic) {
        rising = true;
      } else if (rising && prevDynamic > cfg.peakThresholdMps2) {
        // Falling edge right after a peak above threshold.
        if (timestampMs - lastStepAt > cfg.minStepIntervalMs) {
          stepped = true;
          count += 1;
          lastStepAt = timestampMs;
        }
        rising = false;
      } else {
        rising = false;
      }
      prevDynamic = dynamic;
      return stepped;
    },
    reset() {
      gravity = cfg.initialGravity;
      prevDynamic = 0;
      rising = false;
      lastStepAt = 0;
      count = 0;
    },
    get stepCount(): number {
      return count;
    },
  };
}
