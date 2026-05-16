import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from './env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { logger } from './logger.js';
import { buildAuthRouter } from './modules/auth/auth.router.js';
import { buildEntitiesRouter } from './modules/entities/entities.router.js';
import { buildGusRouter } from './modules/gus/gus.router.js';
import { buildUsersRouter } from './modules/users/users.router.js';
import { buildWalksRouter } from './modules/walks/walks.router.js';
import { buildWeatherRouter } from './modules/weather/weather.router.js';
import { buildHealthRouter } from './health.js';

import './types.js';

export function buildApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.ALLOWED_ORIGINS.includes('*')) return cb(null, true);
        if (env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as { requestId?: string }).requestId ?? 'unknown',
      customLogLevel: (_req, res, err) => {
        if (err) return 'error';
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use('/', buildHealthRouter());

  const base = `/api/${env.API_VERSION}`;
  app.use(`${base}/auth`, buildAuthRouter());
  app.use(`${base}/entities`, buildEntitiesRouter());
  app.use(`${base}/users`, buildUsersRouter());
  app.use(`${base}/walks`, buildWalksRouter());
  app.use(`${base}/gus`, buildGusRouter());
  app.use(`${base}/weather`, buildWeatherRouter());

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.path}`,
        requestId: req.requestId,
      },
    });
  });

  app.use(errorHandler);

  return app;
}
