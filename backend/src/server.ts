import 'dotenv/config';

import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { redis } from './redis.js';

async function start(): Promise<void> {
  const app = buildApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        api: `/api/${env.API_VERSION}`,
      },
      'ParkWalk backend ready. Bind 0.0.0.0 so your iPhone on LAN can reach it.',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown initiated');
    server.close(() => logger.info('http server closed'));
    try {
      await prisma.$disconnect();
      redis.disconnect();
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

void start();
