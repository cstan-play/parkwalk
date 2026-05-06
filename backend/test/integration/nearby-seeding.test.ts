import request from 'supertest';

import { buildApp } from '../../src/app.js';
import { env } from '../../src/env.js';
import { offsetMeters } from '../../src/modules/entities/placement.geo.js';
import {
  setWalkableSnapFinderForTests,
} from '../../src/modules/entities/placement.service.js';
import type { SnappedPlacementCandidate } from '../../src/modules/entities/walkable-snapping.js';
import { prisma } from '../../src/prisma.js';

import { resetDatabase } from './setup.js';

const app = buildApp();

async function registerAndLogin() {
  const suffix = `${Date.now()}_${Math.round(Math.random() * 10000)}`;
  const payload = {
    username: `nearby_${suffix}`,
    email: `nearby_${suffix}@example.com`,
    password: 'password-1234-abcd',
  };
  const res = await request(app).post('/api/v1/auth/register').send(payload);
  expect(res.status).toBe(201);
  return { tokens: res.body.tokens as { accessToken: string } };
}

describe('GET /api/v1/entities/nearby auto-seeding', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    env.WALKABLE_SNAPPING_ENABLED = false;
    env.MAPBOX_ACCESS_TOKEN = undefined;
    setWalkableSnapFinderForTests(null);
  });

  it('tops up nearby collectibles around the requested location', async () => {
    const { tokens } = await registerAndLogin();
    const lat = 55.6761;
    const lng = 12.5683;

    const res = await request(app)
      .get('/api/v1/entities/nearby')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .query({ lat, lng, radiusMeters: 250, limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    for (const item of res.body.items) {
      expect(item.type).toBe('collectible');
      expect(item.config.placement.source).toBe('nearby_auto_seed');
      expect(item.distanceMeters).toBeGreaterThanOrEqual(15);
      expect(item.distanceMeters).toBeLessThanOrEqual(100);
    }

    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM game_entities
      WHERE config->'placement'->>'source' = 'nearby_auto_seed'
    `;
    expect(Number(rows[0]!.count)).toBe(5);
  });

  it('stores snapped placement metadata without changing the nearby source key', async () => {
    const { tokens } = await registerAndLogin();
    const lat = 55.6761;
    const lng = 12.5683;
    env.WALKABLE_SNAPPING_ENABLED = true;
    env.MAPBOX_ACCESS_TOKEN = 'pk.test';
    setWalkableSnapFinderForTests(async ({ center, wanted }) =>
      Array.from({ length: wanted }, (_, index): SnappedPlacementCandidate => {
        const point = offsetMeters(center, 45, index * 72);
        return {
          ...point,
          originalCandidate: center,
          snap: {
            status: 'snapped',
            provider: 'mapbox_tilequery',
            distanceMeters: 3,
            featureId: `path-${index}`,
            class: 'path',
            type: 'footway',
            name: 'Test path',
          },
        };
      }),
    );

    const res = await request(app)
      .get('/api/v1/entities/nearby')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .query({ lat, lng, radiusMeters: 250, limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    const placement = res.body.items[0].config.placement;
    expect(placement.source).toBe('nearby_auto_seed');
    expect(placement.version).toBe(2);
    expect(placement.center).toEqual({ latitude: lat, longitude: lng });
    expect(placement.radiusMeters).toBe(90);
    expect(placement.snap).toMatchObject({
      status: 'snapped',
      provider: 'mapbox_tilequery',
      class: 'path',
      type: 'footway',
    });
  });

  it('falls back to unsnapped placement when snapping produces no candidates', async () => {
    const { tokens } = await registerAndLogin();
    env.WALKABLE_SNAPPING_ENABLED = true;
    env.MAPBOX_ACCESS_TOKEN = 'pk.test';
    setWalkableSnapFinderForTests(async () => []);

    const res = await request(app)
      .get('/api/v1/entities/nearby')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .query({ lat: 55.6761, lng: 12.5683, radiusMeters: 250, limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    for (const item of res.body.items) {
      expect(item.config.placement.source).toBe('nearby_auto_seed');
      expect(item.config.placement.version).toBe(2);
      expect(item.config.placement.snap).toEqual({
        status: 'fallback_unsnapped',
        provider: 'mapbox_tilequery',
      });
    }
  });

  it('does not create more markers once target count is visible', async () => {
    const { tokens } = await registerAndLogin();
    const query = { lat: 55.6761, lng: 12.5683, radiusMeters: 250, limit: 20 };

    await request(app)
      .get('/api/v1/entities/nearby')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .query(query)
      .expect(200);
    const second = await request(app)
      .get('/api/v1/entities/nearby')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .query(query)
      .expect(200);

    expect(second.body.items).toHaveLength(5);
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM game_entities
    `;
    expect(Number(rows[0]!.count)).toBe(5);
  });
});
