import type {
  AuthResponse,
  AuthUser,
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
  TokenPair,
} from '@parkwalk/shared';
import argon2 from 'argon2';

import { conflict, unauthorized } from '../../errors.js';
import { prisma } from '../../prisma.js';

import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';

function toAuthUser(u: {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}): AuthUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueTokens(
  userId: string,
  username: string,
  email: string,
  device: { ip?: string | null; userAgent?: string | null },
): Promise<TokenPair> {
  const access = signAccessToken({ sub: userId, username, email });
  const refresh = generateRefreshToken();

  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
      ipAddress: device.ip ?? null,
      userAgent: device.userAgent ?? null,
    },
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.raw,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
}

export async function register(
  input: RegisterRequest,
  device: { ip?: string | null; userAgent?: string | null },
): Promise<AuthResponse> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, { email: input.email }] },
    select: { id: true, username: true, email: true },
  });
  if (existing) {
    const field = existing.email === input.email ? 'email' : 'username';
    throw conflict(`A user with that ${field} already exists`);
  }
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      passwordHash,
      displayName: input.displayName ?? null,
      stats: { create: {} },
    },
  });
  const tokens = await issueTokens(user.id, user.username, user.email, device);
  return { user: toAuthUser(user), tokens };
}

export async function login(
  input: LoginRequest,
  device: { ip?: string | null; userAgent?: string | null },
): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.isActive) throw unauthorized('Invalid credentials');
  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) throw unauthorized('Invalid credentials');
  await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
  const tokens = await issueTokens(user.id, user.username, user.email, device);
  return { user: toAuthUser(user), tokens };
}

export async function refresh(
  input: RefreshRequest,
  device: { ip?: string | null; userAgent?: string | null },
): Promise<TokenPair> {
  const hash = hashRefreshToken(input.refreshToken);
  const session = await prisma.session.findFirst({
    where: { refreshTokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!session) throw unauthorized('Invalid refresh token');

  // Rotate: revoke current session, issue a new one. If the old refresh
  // token is reused later, it will fail because revokedAt is set.
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(session.user.id, session.user.username, session.user.email, device);
}

export async function logout(refreshToken: string): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  await prisma.session.updateMany({
    where: { refreshTokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
