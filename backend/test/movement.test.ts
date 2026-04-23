import { validateMovement } from '../src/modules/movement/movement.service.js';

import { drivingFixture, rebaseFixtureToNow, teleportSpoofFixture, walkingFixture } from './fixtures/index.js';

describe('MovementValidationService', () => {
  describe('walking fixture', () => {
    it('is ACCEPTED', () => {
      const fx = rebaseFixtureToNow(walkingFixture);
      const result = validateMovement({ summary: fx.summary, samples: fx.samples });
      expect(result).toMatchObject({
        valid: true,
        state: 'WALKING_VALID',
      });
      expect(result.reasons).toEqual([]);
      expect(result.score).toBeGreaterThan(0.8);
    });

    it('is REJECTED when samples are missing (summary alone is not enough)', () => {
      // Previously accepted; flipped per the MVP+Alpha model. Raw samples
      // are the server's only way to replay the walk (teleport + automotive
      // checks live there), so a collect without samples cannot be verified.
      const fx = rebaseFixtureToNow(walkingFixture);
      const result = validateMovement({ summary: fx.summary });
      expect(result.valid).toBe(false);
      expect(result.reasons.join('|')).toMatch(/samples/i);
    });
  });

  describe('driving fixture', () => {
    it('is REJECTED with a speed or activity reason', () => {
      const fx = rebaseFixtureToNow(drivingFixture);
      const result = validateMovement({ summary: fx.summary, samples: fx.samples });
      expect(result.valid).toBe(false);
      const joined = result.reasons.join('|').toLowerCase();
      expect(joined).toMatch(/speed|vehicle|automotive|state/);
    });
  });

  describe('teleport-spoof fixture', () => {
    it('is REJECTED even though the summary claims WALKING_VALID', () => {
      const fx = rebaseFixtureToNow(teleportSpoofFixture);
      const result = validateMovement({ summary: fx.summary, samples: fx.samples });
      expect(result.valid).toBe(false);
      const joined = result.reasons.join('|').toLowerCase();
      expect(joined).toMatch(/teleport|spoof/);
    });
  });

  describe('freshness', () => {
    it('SOFT-FLAGS a summary older than 60s (staleness is evidence, not a gate)', () => {
      // Previously a hard reject; moved to a soft flag per the MVP+Alpha
      // soft-validation model (docs/07-MOVEMENT-DETECTION.md). The server
      // still re-verifies position with ST_DWithin using the request's
      // `location` field, so a stale summary cannot by itself let a user
      // collect from the wrong place.
      const fx = rebaseFixtureToNow(walkingFixture);
      const stale = {
        ...fx.summary,
        generatedAt: new Date(Date.now() - 120_000).toISOString(),
      };
      const result = validateMovement({ summary: stale, samples: fx.samples });
      expect(result.valid).toBe(true);
      expect(result.flags).toContain('STALE_SUMMARY');
    });

    it('REJECTS a summary with a future timestamp', () => {
      const fx = rebaseFixtureToNow(walkingFixture);
      const future = {
        ...fx.summary,
        generatedAt: new Date(Date.now() + 120_000).toISOString(),
      };
      const result = validateMovement({ summary: future, samples: fx.samples });
      expect(result.valid).toBe(false);
      expect(result.reasons.join('|')).toMatch(/future/);
    });
  });

  describe('soft flags on the happy path', () => {
    it('walking with UNKNOWN activity flags UNKNOWN_ACTIVITY but accepts', () => {
      const fx = rebaseFixtureToNow(walkingFixture);
      const summary = { ...fx.summary, dominantActivity: 'UNKNOWN' as const };
      const result = validateMovement({ summary, samples: fx.samples });
      expect(result.valid).toBe(true);
      expect(result.flags).toContain('UNKNOWN_ACTIVITY');
    });

    it('walking with zero step rate + non-zero speed flags NO_STEPS_DURING_MOVEMENT but accepts', () => {
      const fx = rebaseFixtureToNow(walkingFixture);
      const summary = { ...fx.summary, stepRateHz: 0 };
      const result = validateMovement({ summary, samples: fx.samples });
      expect(result.valid).toBe(true);
      expect(result.flags).toContain('NO_STEPS_DURING_MOVEMENT');
    });
  });

  describe('missing samples', () => {
    it('REJECTS a collect with no samples attached', () => {
      const fx = rebaseFixtureToNow(walkingFixture);
      const result = validateMovement({ summary: fx.summary, samples: [] });
      expect(result.valid).toBe(false);
      expect(result.reasons.join('|')).toMatch(/samples/i);
    });
  });
});
