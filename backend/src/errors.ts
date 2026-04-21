import type { ErrorCode } from '@parkwalk/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (message = 'Unauthorized') =>
  new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code: ErrorCode = 'CONFLICT') =>
  new ApiError(409, code, message);
export const validationError = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);
export const outOfRange = (message = 'Out of range') =>
  new ApiError(400, 'OUT_OF_RANGE', message);
export const movementInvalid = (message: string, details?: unknown) =>
  new ApiError(400, 'MOVEMENT_INVALID', message, details);
export const alreadyCollected = (message = 'Already collected') =>
  new ApiError(409, 'ALREADY_COLLECTED', message);
export const idempotencyMismatch = () =>
  new ApiError(409, 'IDEMPOTENCY_MISMATCH', 'Idempotency-Key was reused with a different request');
