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

    it('is ACCEPTED even with the summary alone (no samples)', () => {
      const fx = rebaseFixtureToNow(walkingFixture);
      const result = validateMovement({ summary: fx.summary });
      expect(result.valid).toBe(true);
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
    it('REJECTS a summary older than 60s', () => {
      const stale = {
        ...walkingFixture.summary,
        generatedAt: new Date(Date.now() - 120_000).toISOString(),
      };
      const result = validateMovement({ summary: stale });
      expect(result.valid).toBe(false);
      expect(result.reasons.join('|')).toMatch(/stale/);
    });

    it('REJECTS a summary with a future timestamp', () => {
      const future = {
        ...walkingFixture.summary,
        generatedAt: new Date(Date.now() + 120_000).toISOString(),
      };
      const result = validateMovement({ summary: future });
      expect(result.valid).toBe(false);
      expect(result.reasons.join('|')).toMatch(/future/);
    });
  });
});
