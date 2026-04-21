import type { MovementSample } from '@parkwalk/shared';

import type { SensorSource } from './productionSource';

export interface FixtureSourceOptions {
  samples: MovementSample[];
  intervalMs?: number;
  loop?: boolean;
}

/**
 * Deterministic sensor source used by jest tests and the SDK playground.
 * Emits pre-recorded samples at a configurable interval. Pair with a
 * committed fixture from `backend/test/fixtures/*.json`.
 */
export function createFixtureSensorSource(opts: FixtureSourceOptions): SensorSource {
  const { samples, intervalMs = 1000, loop = false } = opts;
  return {
    subscribe(onSample) {
      let i = 0;
      const id = setInterval(() => {
        if (i >= samples.length) {
          if (!loop) {
            clearInterval(id);
            return;
          }
          i = 0;
        }
        onSample(samples[i]!);
        i++;
      }, intervalMs);
      return () => clearInterval(id);
    },
  };
}
