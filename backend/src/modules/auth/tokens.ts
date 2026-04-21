import { createHash, randomBytes } from 'node:crypto';

import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '@parkwalk/shared';
import jwt from 'jsonwebtoken';

import { env } from '../../env.js';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): { token: string; expiresAt: Date } {
  const ttl = env.JWT_ACCESS_TTL_SECONDS || ACCESS_TOKEN_TTL_SECONDS;
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: ttl });
  return { token, expiresAt: new Date(Date.now() + ttl * 1000) };
}

export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(48).toString('base64url');
  const hash = hashRefreshToken(raw);
  const ttl = env.JWT_REFRESH_TTL_SECONDS || REFRESH_TOKEN_TTL_SECONDS;
  return { raw, hash, expiresAt: new Date(Date.now() + ttl * 1000) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
