import Redis from 'ioredis';

import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err) => logger.error({ err }, 'redis error'));
redis.on('ready', () => logger.info('redis ready'));
