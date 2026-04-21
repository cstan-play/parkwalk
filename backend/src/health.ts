import { Router } from 'express';

import { prisma } from './prisma.js';
import { redis } from './redis.js';

export function buildHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: process.uptime() });
  });

  router.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const pong = await redis.ping();
      res.json({ status: 'ready', db: 'ok', redis: pong === 'PONG' ? 'ok' : 'degraded' });
    } catch (err) {
      res.status(503).json({
        status: 'not_ready',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
