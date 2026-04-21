import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../env.js';
import { unauthorized } from '../errors.js';
import { prisma } from '../prisma.js';

interface AccessTokenPayload {
  sub: string;
  username: string;
  email: string;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return next(unauthorized('Missing bearer token'));
    }
    const token = header.slice('Bearer '.length).trim();
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
    } catch {
      return next(unauthorized('Invalid or expired token'));
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return next(unauthorized('User not found or inactive'));
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
    };
    next();
  } catch (err) {
    next(err);
  }
}
