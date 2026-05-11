import type {
  SmellType,
  SyncWalkRequest,
  WalkPathSegment,
  WalkSession,
  WalkSmellSummary,
} from '@parkwalk/shared';
import { smellTypeSchema } from '@parkwalk/shared';
import type { Prisma } from '@prisma/client';

import { notFound } from '../../errors.js';
import { prisma } from '../../prisma.js';
import { getWeatherDescription } from '../../services/weather.js';

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
  weatherSnapshot: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const EMPTY_SMELL_SUMMARY: WalkSmellSummary = { totalCount: 0, byType: {} };

export async function syncWalk(userId: string, request: SyncWalkRequest): Promise<WalkSession> {
  const weatherSnapshot = await resolveWalkWeatherSnapshot(request);

  const walk = await prisma.$transaction(async (tx) => {
    const existing = await tx.walkSession.findUnique({ where: { clientId: request.clientId } });
    // Re-syncs of an already-persisted walk keep their original weather snapshot;
    // weather is observational state captured at the moment the walk was synced
    // and shouldn't drift on idempotent retries.
    const persisted = toPersistedWalk(request, existing ? existing.weatherSnapshot : weatherSnapshot);
    const saved = existing
      ? await tx.walkSession.update({
          where: { clientId: request.clientId },
          data: persisted,
        })
      : await tx.walkSession.create({
          data: {
            ...persisted,
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

  const smellsByWalk = await deriveSmellSummaries([walk.id]);
  return toWalkSession(walk, smellsByWalk.get(walk.id) ?? EMPTY_SMELL_SUMMARY);
}

export async function listWalks(userId: string): Promise<Omit<WalkSession, 'pathSegments'>[]> {
  const rows = await prisma.walkSession.findMany({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
  const smellsByWalk = await deriveSmellSummaries(rows.map((row) => row.id));
  return rows.map((row) => {
    const { pathSegments: _pathSegments, ...rest } = toWalkSession(
      row,
      smellsByWalk.get(row.id) ?? EMPTY_SMELL_SUMMARY,
    );
    return rest;
  });
}

export async function getWalk(userId: string, id: string): Promise<WalkSession> {
  const row = await prisma.walkSession.findFirst({ where: { userId, id } });
  if (!row) throw notFound('Walk not found');
  const smellsByWalk = await deriveSmellSummaries([row.id]);
  return toWalkSession(row, smellsByWalk.get(row.id) ?? EMPTY_SMELL_SUMMARY);
}

function toWalkSession(row: WalkRow, smells: WalkSmellSummary): WalkSession {
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
    weatherSnapshot: row.weatherSnapshot,
    smells,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPersistedWalk(request: SyncWalkRequest, weatherSnapshot: string | null) {
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
    weatherSnapshot,
  };
}

/** Pulls the walk's start GPS fix from the request body if any path point exists. */
function firstPathPoint(segments: WalkPathSegment[]): { lat: number; lng: number } | null {
  for (const segment of segments) {
    const head = segment.points[0];
    if (head) return { lat: head.latitude, lng: head.longitude };
  }
  return null;
}

async function resolveWalkWeatherSnapshot(request: SyncWalkRequest): Promise<string | null> {
  const point = firstPathPoint(request.pathSegments);
  if (!point) return null;
  return await getWeatherDescription(point.lat, point.lng);
}

/**
 * Single round-trip per call: fetch all collections for the given walks plus
 * each collection's entity config, then group by smellType in JS. Walks with
 * no collections (or collections whose entities lack a smellType) return an
 * empty summary keyed in the map.
 */
async function deriveSmellSummaries(
  walkSessionIds: string[],
): Promise<Map<string, WalkSmellSummary>> {
  const map = new Map<string, WalkSmellSummary>();
  for (const id of walkSessionIds) {
    map.set(id, { totalCount: 0, byType: {} });
  }
  if (walkSessionIds.length === 0) return map;

  const rows = await prisma.userCollection.findMany({
    where: { walkSessionId: { in: walkSessionIds } },
    select: {
      walkSessionId: true,
      entity: { select: { config: true } },
    },
  });

  for (const row of rows) {
    if (!row.walkSessionId) continue;
    const summary = map.get(row.walkSessionId);
    if (!summary) continue;
    summary.totalCount += 1;
    const config = (row.entity?.config ?? {}) as { smellType?: unknown };
    const parsed = smellTypeSchema.safeParse(config.smellType);
    if (parsed.success) {
      const key = parsed.data satisfies SmellType;
      summary.byType[key] = (summary.byType[key] ?? 0) + 1;
    }
  }
  return map;
}

function startOfUtcDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}
