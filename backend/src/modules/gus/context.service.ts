import type { GusContextForPrompt } from '@parkwalk/shared';

import { prisma } from '../../prisma.js';

interface AssembleContextInput {
  userId: string;
  ownerName: string;
  /** Inject for tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Read enough of the user's recent state to make Gus sound informed
 * without looking informed (per the bible: "treats data as context for
 * character, not metrics to report").
 *
 * Sprint 0 sources: dog profile (already passed in by caller), walk
 * sessions, latest user_daily_state. Weather is null until a small
 * integration lands; no medications surfacing yet.
 */
export async function assembleContextForPrompt(
  input: AssembleContextInput,
): Promise<GusContextForPrompt> {
  const now = input.now ?? new Date();

  const [recentWalks, lastDailyState] = await Promise.all([
    prisma.walkSession.findMany({
      where: { userId: input.userId },
      orderBy: { endedAt: 'desc' },
      take: 14,
      select: {
        startedAt: true,
        endedAt: true,
        movingDurationSeconds: true,
      },
    }),
    prisma.userDailyState.findFirst({
      where: { userId: input.userId },
      orderBy: { date: 'desc' },
      select: { mood: true, motorState: true },
    }),
  ]);

  const lastWalk = recentWalks[0];
  const lastWalkHoursAgo = lastWalk
    ? Math.max(0, Math.round((now.getTime() - lastWalk.endedAt.getTime()) / (60 * 60 * 1000)))
    : null;

  const today = startOfDay(now);
  const todayWalk = recentWalks.find((w) => w.endedAt >= today);
  const todayWalkMinutes = todayWalk ? Math.round(todayWalk.movingDurationSeconds / 60) : null;

  const streakDays = computeStreakDays(recentWalks.map((w) => w.endedAt), now);

  return {
    ownerName: input.ownerName,
    timeOfDay: timeOfDayBucket(now),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    lastWalkHoursAgo,
    todayWalkMinutes,
    streakDays,
    lastMood: lastDailyState?.mood ?? null,
    lastMotorState: lastDailyState?.motorState ?? null,
    weather: null,
  };
}

function timeOfDayBucket(d: Date): GusContextForPrompt['timeOfDay'] {
  const h = d.getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'midday';
  if (h < 22) return 'evening';
  return 'night';
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function computeStreakDays(endedAts: Date[], now: Date): number {
  if (endedAts.length === 0) return 0;
  const days = new Set<string>();
  for (const ts of endedAts) {
    days.add(toLocalDateKey(ts));
  }
  let streak = 0;
  let cursor = startOfDay(now);
  while (days.has(toLocalDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}
