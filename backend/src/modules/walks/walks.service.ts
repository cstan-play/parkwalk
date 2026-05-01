import type { SyncWalkRequest, WalkSession } from '@parkwalk/shared';
import type { Prisma } from '@prisma/client';

import { notFound } from '../../errors.js';
import { prisma } from '../../prisma.js';

type WalkRow = {
  id: string;
  clientId: string;
  status: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  movingDurationSeconds: number;
  pausedDurationSeconds: number;
  distanceMeters: Prisma.Decimal;
  stepCount: number;
  collectedCount: number;
  autoFinished: boolean;
  autoFinishReason: string | null;
  pathPointCount: number;
  pathSegments: Prisma.JsonValue;
  pauseIntervals: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function syncWalk(userId: string, request: SyncWalkRequest): Promise<WalkSession> {
  const walk = await prisma.$transaction(async (tx) => {
    const existing = await tx.walkSession.findUnique({ where: { clientId: request.clientId } });
    const saved = existing
      ? await tx.walkSession.update({
          where: { clientId: request.clientId },
          data: toPersistedWalk(request),
        })
      : await tx.walkSession.create({
          data: {
            ...toPersistedWalk(request),
            clientId: request.clientId,
            userId,
          },
        });

    if (!existing) {
      await tx.userStats.upsert({
        where: { userId },
        update: {
          totalDistanceMeters: { increment: BigInt(Math.round(request.distanceMeters)) },
          dailyDistanceMeters: { increment: BigInt(Math.round(request.distanceMeters)) },
          weeklyDistanceMeters: { increment: BigInt(Math.round(request.distanceMeters)) },
          totalWalkingMinutes: { increment: Math.round(request.movingDurationSeconds / 60) },
          dailyWalkingMinutes: { increment: Math.round(request.movingDurationSeconds / 60) },
          lastActivityDate: startOfUtcDay(new Date(request.endedAt)),
        },
        create: {
          userId,
          totalDistanceMeters: BigInt(Math.round(request.distanceMeters)),
          dailyDistanceMeters: BigInt(Math.round(request.distanceMeters)),
          weeklyDistanceMeters: BigInt(Math.round(request.distanceMeters)),
          totalWalkingMinutes: Math.round(request.movingDurationSeconds / 60),
          dailyWalkingMinutes: Math.round(request.movingDurationSeconds / 60),
          lastActivityDate: startOfUtcDay(new Date(request.endedAt)),
        },
      });
    }

    await tx.userCollection.updateMany({
      where: { userId, walkClientId: request.clientId, walkSessionId: null },
      data: { walkSessionId: saved.id },
    });

    return saved;
  });

  return toWalkSession(walk);
}

export async function listWalks(userId: string): Promise<Omit<WalkSession, 'pathSegments'>[]> {
  const rows = await prisma.walkSession.findMany({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
  return rows.map((row) => {
    const { pathSegments: _pathSegments, ...rest } = toWalkSession(row);
    return rest;
  });
}

export async function getWalk(userId: string, id: string): Promise<WalkSession> {
  const row = await prisma.walkSession.findFirst({ where: { userId, id } });
  if (!row) throw notFound('Walk not found');
  return toWalkSession(row);
}

function toWalkSession(row: WalkRow): WalkSession {
  return {
    id: row.id,
    clientId: row.clientId,
    status: row.status as WalkSession['status'],
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    durationSeconds: row.durationSeconds,
    movingDurationSeconds: row.movingDurationSeconds,
    pausedDurationSeconds: row.pausedDurationSeconds,
    distanceMeters: Number(row.distanceMeters),
    stepCount: row.stepCount,
    collectedCount: row.collectedCount,
    autoFinished: row.autoFinished,
    autoFinishReason: row.autoFinishReason,
    pathPointCount: row.pathPointCount,
    pathSegments: Array.isArray(row.pathSegments)
      ? (row.pathSegments as WalkSession['pathSegments'])
      : [],
    pauseIntervals: Array.isArray(row.pauseIntervals)
      ? (row.pauseIntervals as WalkSession['pauseIntervals'])
      : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPersistedWalk(request: SyncWalkRequest) {
  return {
    status: request.status,
    startedAt: new Date(request.startedAt),
    endedAt: new Date(request.endedAt),
    durationSeconds: request.durationSeconds,
    movingDurationSeconds: request.movingDurationSeconds,
    pausedDurationSeconds: request.pausedDurationSeconds,
    distanceMeters: request.distanceMeters,
    stepCount: request.stepCount,
    collectedCount: request.collectedCount,
    autoFinished: request.autoFinished,
    autoFinishReason: request.autoFinishReason ?? null,
    pathPointCount: request.pathSegments.reduce((sum, segment) => sum + segment.points.length, 0),
    pathSegments: request.pathSegments,
    pauseIntervals: request.pauseIntervals,
  };
}

function startOfUtcDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}
