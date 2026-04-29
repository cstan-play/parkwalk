import { syncWalkRequestSchema, uuidSchema } from '@parkwalk/shared';
import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';

import { getWalk, listWalks, syncWalk } from './walks.service.js';

const walkParamsSchema = z.object({ id: uuidSchema });

export function buildWalksRouter(): Router {
  const router = Router();

  router.use(authenticate);

  router.post(
    '/',
    validate(syncWalkRequestSchema),
    asyncHandler(async (req, res) => {
      const walk = await syncWalk(req.user!.id, req.body);
      res.status(201).json({ walk });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const items = await listWalks(req.user!.id);
      res.json({ items });
    }),
  );

  router.get(
    '/:id',
    validate(walkParamsSchema, 'params'),
    asyncHandler(async (req, res) => {
      const walk = await getWalk(req.user!.id, req.params.id!);
      res.json({ walk });
    }),
  );

  return router;
}
