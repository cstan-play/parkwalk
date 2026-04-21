import {
  RATE_LIMIT_AUTH_PER_MIN,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
} from '@parkwalk/shared';
import { Router, type Request, type Response } from 'express';

import { authenticate } from '../../middleware/auth.js';
import { createRateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';

import { login, logout, refresh, register } from './auth.service.js';

export function buildAuthRouter(): Router {
  const router = Router();

  const limit = createRateLimit({
    keyPrefix: 'rl:auth',
    points: RATE_LIMIT_AUTH_PER_MIN,
    durationSeconds: 60,
    keyBy: (req) => req.ip ?? 'anon',
  });

  router.post(
    '/register',
    limit,
    validate(registerRequestSchema),
    async (req: Request, res: Response) => {
      const result = await register(req.body, {
        ip: req.ip,
        userAgent: req.header('user-agent') ?? null,
      });
      res.status(201).json(result);
    },
  );

  router.post('/login', limit, validate(loginRequestSchema), async (req: Request, res: Response) => {
    const result = await login(req.body, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? null,
    });
    res.json(result);
  });

  router.post('/refresh', limit, validate(refreshRequestSchema), async (req, res) => {
    const tokens = await refresh(req.body, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? null,
    });
    res.json({ tokens });
  });

  router.post('/logout', authenticate, validate(refreshRequestSchema), async (req, res) => {
    await logout(req.body.refreshToken);
    res.status(204).send();
  });

  router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
