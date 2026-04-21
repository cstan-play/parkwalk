import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MovementSample, MovementSummary } from '@parkwalk/shared';

export interface Fixture {
  description: string;
  summary: MovementSummary;
  samples: MovementSample[];
}

function load(name: string): Fixture {
  const raw = readFileSync(join(__dirname, name), 'utf8');
  return JSON.parse(raw) as Fixture;
}

export const walkingFixture: Fixture = load('walking.json');
export const drivingFixture: Fixture = load('driving.json');
export const teleportSpoofFixture: Fixture = load('teleport-spoof.json');

export const allFixtures: Record<string, Fixture> = {
  walking: walkingFixture,
  driving: drivingFixture,
  teleportSpoof: teleportSpoofFixture,
};

/**
 * Shifts all timestamps in a fixture so that its last sample lands at `now`.
 * Useful for tests where the service rejects "stale" summaries.
 */
export function rebaseFixtureToNow(fixture: Fixture, now: Date = new Date()): Fixture {
  const last = Date.parse(fixture.summary.generatedAt);
  const delta = now.getTime() - last;
  return {
    ...fixture,
    summary: {
      ...fixture.summary,
      generatedAt: new Date(Date.parse(fixture.summary.generatedAt) + delta).toISOString(),
    },
    samples: fixture.samples.map((s) => ({
      ...s,
      timestamp: new Date(Date.parse(s.timestamp) + delta).toISOString(),
    })),
  };
}
