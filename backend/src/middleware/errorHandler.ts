import type { ErrorRequestHandler } from 'express';

import { ApiError } from '../errors.js';
import { logger } from '../logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId ?? 'unknown';

  if (err instanceof ApiError) {
    if (err.status >= 500) {
      logger.error({ err, requestId }, 'api error');
    } else {
      logger.warn({ err, requestId, code: err.code }, 'client error');
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
    return;
  }

  logger.error({ err, requestId }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId,
    },
  });
};
