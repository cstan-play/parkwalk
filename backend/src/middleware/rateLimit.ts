import type { NextFunction, Request, Response } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';

import { ApiError } from '../errors.js';
import { redis } from '../redis.js';

export function createRateLimit(opts: {
  keyPrefix: string;
  points: number;
  durationSeconds: number;
  keyBy?: (req: Request) => string;
}) {
  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: opts.keyPrefix,
    points: opts.points,
    duration: opts.durationSeconds,
  });

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const key = opts.keyBy
      ? opts.keyBy(req)
      : (req.user?.id ?? req.ip ?? 'anon');
    try {
      await limiter.consume(key, 1);
      next();
    } catch (rateErr) {
      const retryMs = (rateErr as { msBeforeNext?: number }).msBeforeNext ?? 1000;
      next(
        new ApiError(429, 'RATE_LIMITED', 'Too many requests', {
          retryAfterSeconds: Math.ceil(retryMs / 1000),
        }),
      );
    }
  };
}
