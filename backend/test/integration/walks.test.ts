import request from 'supertest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/prisma.js';

import { resetDatabase } from './setup.js';

const app = buildApp();

async function registerAndLogin() {
  const stamp = `${Date.now()}_${Math.round(Math.random() * 100_000)}`;
  const payload = {
    username: `walker_${stamp}`,
    email: `walker_${stamp}@example.com`,
    password: 'password-1234-abcd',
  };
  const res = await request(app).post('/api/v1/auth/register').send(payload);
  expect(res.status).toBe(201);
  return { tokens: res.body.tokens as { accessToken: string }, user: res.body.user };
}

describe('POST /api/v1/walks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('syncs, lists, and returns segmented walk paths', async () => {
    const { tokens } = await registerAndLogin();
    const clientId = '44444444-4444-4444-8444-444444444444';
    const payload = {
      clientId,
      status: 'completed',
      startedAt: '2026-05-01T10:00:00.000Z',
      endedAt: '2026-05-01T10:05:00.000Z',
      durationSeconds: 300,
      movingDurationSeconds: 240,
      pausedDurationSeconds: 60,
      distanceMeters: 42.75,
      stepCount: 88,
      collectedCount: 0,
      autoFinished: false,
      autoFinishReason: null,
      pathSegments: [
        {
          startedAt: '2026-05-01T10:00:00.000Z',
          endedAt: '2026-05-01T10:02:00.000Z',
          points: [
            {
              latitude: 55.6761,
              longitude: 12.5683,
              accuracy: 5,
              recordedAt: '2026-05-01T10:00:00.000Z',
              stepCountTotal: 0,
              source: 'gps',
            },
            {
              latitude: 55.6762,
              longitude: 12.5683,
              accuracy: 5,
              recordedAt: '2026-05-01T10:00:30.000Z',
              stepCountTotal: 20,
              source: 'gps',
            },
          ],
        },
        {
          startedAt: '2026-05-01T10:03:00.000Z',
          endedAt: '2026-05-01T10:05:00.000Z',
          points: [
            {
              latitude: 55.677,
              longitude: 12.569,
              accuracy: 5,
              recordedAt: '2026-05-01T10:03:00.000Z',
              stepCountTotal: 40,
              source: 'gps',
            },
            {
              latitude: 55.6771,
              longitude: 12.569,
              accuracy: 5,
              recordedAt: '2026-05-01T10:03:30.000Z',
              stepCountTotal: 60,
              source: 'gps',
            },
          ],
        },
      ],
      pauseIntervals: [
        {
          startedAt: '2026-05-01T10:02:00.000Z',
          endedAt: '2026-05-01T10:03:00.000Z',
        },
      ],
    };

    const sync = await request(app)
      .post('/api/v1/walks')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send(payload);

    expect(sync.status).toBe(201);
    expect(sync.body.walk.pathPointCount).toBe(4);
    expect(sync.body.walk.pathSegments).toHaveLength(2);

    const row = await prisma.walkSession.findUniqueOrThrow({ where: { clientId } });
    expect(row.pathPointCount).toBe(4);
    expect(row.pathSegments).toEqual(payload.pathSegments);

    const list = await request(app)
      .get('/api/v1/walks')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].pathSegments).toBeUndefined();

    const detail = await request(app)
      .get(`/api/v1/walks/${sync.body.walk.id}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.walk.pathSegments).toEqual(payload.pathSegments);
  });
});
