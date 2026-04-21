import type { NextFunction, Request, Response } from 'express';
import type { z, ZodError } from 'zod';

import { validationError } from '../errors.js';

type Source = 'body' | 'query' | 'params';

function flatten(err: ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

export function validate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: Source = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(data);
    if (!result.success) {
      return next(validationError(`Invalid ${source}`, flatten(result.error)));
    }
    if (source === 'body') req.body = result.data;
    else if (source === 'query') (req as unknown as { query: unknown }).query = result.data;
    else (req as unknown as { params: unknown }).params = result.data;
    next();
  };
}
