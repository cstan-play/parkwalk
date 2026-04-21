import request from 'supertest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/prisma.js';
import { drivingFixture, rebaseFixtureToNow, walkingFixture } from '../fixtures/index.js';

import { resetDatabase } from './setup.js';

const app = buildApp();

async function registerAndLogin() {
  const payload = {
    username: `tester_${Date.now()}`,
    email: `tester_${Date.now()}@example.com`,
    password: 'password-1234-abcd',
  };
  const res = await request(app).post('/api/v1/auth/register').send(payload);
  expect(res.status).toBe(201);
  return { tokens: res.body.tokens as { accessToken: string }, user: res.body.user };
}

async function seedCollectibleAt(lat: number, lng: number, name = 'Test Coin'): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO game_entities (type, location, config, collection_radius_meters)
    VALUES (
      'collectible',
      ST_MakePoint(${lng}, ${lat})::geography,
      ${JSON.stringify({ name, points: 10 })}::jsonb,
      10
    )
    RETURNING id
  `;
  return rows[0]!.id;
}

describe('POST /api/v1/entities/collect', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('accepts a valid walking collect within range', async () => {
    const { tokens } = await registerAndLogin();
    const fx = rebaseFixtureToNow(walkingFixture);
    const userLat = fx.samples.at(-1)!.location.latitude;
    const userLng = fx.samples.at(-1)!.location.longitude;
    const entityId = await seedCollectibleAt(userLat, userLng);

    const res = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', `first-${Date.now()}`)
      .send({
        entityId,
        location: { latitude: userLat, longitude: userLng, accuracy: 5 },
        summary: fx.summary,
        samples: fx.samples,
        clientSentAt: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.collection.entityId).toBe(entityId);
    expect(res.body.collection.movementValidated).toBe(true);
    expect(res.body.rewards.pointsEarned).toBe(10);
  });

  it('rejects a collect while driving', async () => {
    const { tokens } = await registerAndLogin();
    const fx = rebaseFixtureToNow(drivingFixture);
    const userLat = fx.samples.at(-1)!.location.latitude;
    const userLng = fx.samples.at(-1)!.location.longitude;
    const entityId = await seedCollectibleAt(userLat, userLng);

    const res = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', `drive-${Date.now()}`)
      .send({
        entityId,
        location: { latitude: userLat, longitude: userLng, accuracy: 5 },
        summary: fx.summary,
        samples: fx.samples,
        clientSentAt: new Date().toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MOVEMENT_INVALID');
  });

  it('rejects a collect out of range', async () => {
    const { tokens } = await registerAndLogin();
    const fx = rebaseFixtureToNow(walkingFixture);
    const entityId = await seedCollectibleAt(40.0, -120.0);

    const res = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', `range-${Date.now()}`)
      .send({
        entityId,
        location: fx.samples.at(-1)!.location,
        summary: fx.summary,
        samples: fx.samples,
        clientSentAt: new Date().toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OUT_OF_RANGE');
  });

  it('rejects a duplicate collect with the same Idempotency-Key (returns stored result)', async () => {
    const { tokens } = await registerAndLogin();
    const fx = rebaseFixtureToNow(walkingFixture);
    const userLat = fx.samples.at(-1)!.location.latitude;
    const userLng = fx.samples.at(-1)!.location.longitude;
    const entityId = await seedCollectibleAt(userLat, userLng);
    const idem = `dup-${Date.now()}`;

    const body = {
      entityId,
      location: { latitude: userLat, longitude: userLng, accuracy: 5 },
      summary: fx.summary,
      samples: fx.samples,
      clientSentAt: new Date().toISOString(),
    };
    const first = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', idem)
      .send(body);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', idem)
      .send(body);
    expect([200, 201]).toContain(second.status);
    expect(second.body.collection.id).toBe(first.body.collection.id);
  });

  it('rejects re-collecting the same entity with a new key', async () => {
    const { tokens } = await registerAndLogin();
    const fx = rebaseFixtureToNow(walkingFixture);
    const userLat = fx.samples.at(-1)!.location.latitude;
    const userLng = fx.samples.at(-1)!.location.longitude;
    const entityId = await seedCollectibleAt(userLat, userLng);

    const base = {
      entityId,
      location: { latitude: userLat, longitude: userLng, accuracy: 5 },
      summary: fx.summary,
      samples: fx.samples,
      clientSentAt: new Date().toISOString(),
    };
    const first = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', 'k1')
      .send(base);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/entities/collect')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .set('Idempotency-Key', 'k2')
      .send(base);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_COLLECTED');
  });
});
