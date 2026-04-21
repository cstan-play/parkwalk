import type { NextFunction, Request, Response } from 'express';

import { validationError } from '../errors.js';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export function requireIdempotencyKey(req: Request, _res: Response, next: NextFunction): void {
  const key = req.header('idempotency-key');
  if (!key) {
    return next(validationError('Missing Idempotency-Key header'));
  }
  if (!KEY_PATTERN.test(key)) {
    return next(validationError('Invalid Idempotency-Key format'));
  }
  req.idempotencyKey = key;
  next();
}
