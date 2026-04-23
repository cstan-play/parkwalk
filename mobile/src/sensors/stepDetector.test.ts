import { createStepDetector } from './stepDetector';

describe('createStepDetector', () => {
  test('counts zero steps for a perfectly still phone', () => {
    const d = createStepDetector();
    for (let t = 0; t < 5000; t += 33) {
      d.update(0, 0, 9.81, t);
    }
    expect(d.stepCount).toBe(0);
  });

  test('counts zero steps for pure gravity jitter below threshold', () => {
    const d = createStepDetector();
    for (let t = 0; t < 5000; t += 33) {
      const jitter = Math.sin(t / 50) * 0.3; // <1.0 m/s^2
      d.update(jitter, 0, 9.81, t);
    }
    expect(d.stepCount).toBe(0);
  });

  test('counts ~N steps for a synthetic walking signal at 2 Hz', () => {
    const d = createStepDetector();
    // Simulate 10 seconds of walking at 2 steps/sec (20 steps).
    // Each step = one accel peak of amplitude ~2.5 m/s^2 above gravity.
    // Sample at 50 Hz.
    const durationMs = 10_000;
    const stepHz = 2;
    const sampleHz = 50;
    const sampleIntervalMs = 1000 / sampleHz;
    for (let t = 0; t < durationMs; t += sampleIntervalMs) {
      const z = 9.81 + 2.5 * Math.sin((2 * Math.PI * stepHz * t) / 1000);
      d.update(0, 0, z, t);
    }
    // Expect ~20 steps, allow +/- 2 for boundary effects.
    expect(d.stepCount).toBeGreaterThanOrEqual(18);
    expect(d.stepCount).toBeLessThanOrEqual(22);
  });

  test('refractory period caps step rate at ~4 Hz', () => {
    const d = createStepDetector({ minStepIntervalMs: 280 });
    // Synthetic 10Hz peaks (unrealistic) — detector must throttle.
    const durationMs = 2_000;
    const peakHz = 10;
    const sampleHz = 100;
    const sampleIntervalMs = 1000 / sampleHz;
    for (let t = 0; t < durationMs; t += sampleIntervalMs) {
      const z = 9.81 + 3.0 * Math.sin((2 * Math.PI * peakHz * t) / 1000);
      d.update(0, 0, z, t);
    }
    // With 280ms refractory: at most ceil(2000/280) = ~7 steps in 2s.
    expect(d.stepCount).toBeLessThanOrEqual(8);
  });

  test('reset() zeroes the step count and state', () => {
    const d = createStepDetector();
    for (let t = 0; t < 5_000; t += 20) {
      const z = 9.81 + 2.5 * Math.sin((2 * Math.PI * 2 * t) / 1000);
      d.update(0, 0, z, t);
    }
    expect(d.stepCount).toBeGreaterThan(0);
    d.reset();
    expect(d.stepCount).toBe(0);
  });
});
