import request from 'supertest';

import { buildApp } from '../../src/app.js';
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
