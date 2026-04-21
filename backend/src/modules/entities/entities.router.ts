import {
  RATE_LIMIT_COLLECT_PER_MIN,
  RATE_LIMIT_GENERAL_PER_MIN,
  collectRequestSchema,
  nearbyQuerySchema,
} from '@parkwalk/shared';
import { Router } from 'express';

import { authenticate } from '../../middleware/auth.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { createRateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';

import { collect, listNearby } from './entities.service.js';

export function buildEntitiesRouter(): Router {
  const router = Router();

  const nearbyLimit = createRateLimit({
    keyPrefix: 'rl:entities:nearby',
    points: RATE_LIMIT_GENERAL_PER_MIN,
    durationSeconds: 60,
  });
  const collectLimit = createRateLimit({
    keyPrefix: 'rl:entities:collect',
    points: RATE_LIMIT_COLLECT_PER_MIN,
    durationSeconds: 60,
  });

  router.get(
    '/nearby',
    authenticate,
    nearbyLimit,
    validate(nearbyQuerySchema, 'query'),
    async (req, res) => {
      const items = await listNearby(req.query as never);
      res.json({ items });
    },
  );

  router.post(
    '/collect',
    authenticate,
    collectLimit,
    requireIdempotencyKey,
    validate(collectRequestSchema),
    async (req, res) => {
      const result = await collect(req.user!.id, req.idempotencyKey!, req.body);
      res.status(201).json(result);
    },
  );

  return router;
}
