import type { AuthUser } from '@parkwalk/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      idempotencyKey?: string;
    }
  }
}

export {};
