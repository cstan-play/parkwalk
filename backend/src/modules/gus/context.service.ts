import type { GusContextForPrompt } from '@parkwalk/shared';

import { prisma } from '../../prisma.js';
import {
  getWeatherDescription,
  getWeatherSnapshot,
  type WeatherSnapshot,
} from '../../services/weather.js';

export interface WeatherDebugSnapshot {
  coords: { lat: number; lng: number; source: 'input' | 'last_walk' } | null;
  weather: WeatherSnapshot;
}

interface AssembleContextInput {
  userId: string;
  ownerName: string;
  /**
   * Optional explicit coordinates. V1 callers don't pass these — the
   * SendChatRequest / FireNotificationRequest schemas don't carry device
   * location yet (a future enhancement). When omitted we derive lat/lng
   * server-side from the last GPS point of the most recent walk; brand-new
   * users with no walks get `weather: null` (same as before).
   */
  lat?: number;
  lng?: number;
  /** Inject for tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Read enough of the user's recent state to make Gus sound informed
 * without looking informed (per the bible: "treats data as context for
 * character, not metrics to report").
 *
 * Sprint 0 sources: dog profile (already passed in by caller), walk
 * sessions, latest user_daily_state. Weather now resolves from Open-Meteo
 * (cached 1h in Redis), falling back to null when coords aren't derivable
 * or the upstream call fails.
 */
export async function assembleContextForPrompt(
  input: AssembleContextInput,
): Promise<GusContextForPrompt> {
  const now = input.now ?? new Date();

  const [recentWalks, lastDailyState, latestWalkPath] = await Promise.all([
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
    // Separate from the 14-walk findMany above because pathSegments is a
    // chunky JSON column we only need from the single most recent row.
    prisma.walkSession.findFirst({
      where: { userId: input.userId },
      orderBy: { endedAt: 'desc' },
      select: { pathSegments: true },
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

  const coords =
    input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng }
      : extractLatestPoint(latestWalkPath?.pathSegments);
  const weather = coords ? await getWeatherDescription(coords.lat, coords.lng) : null;

  return {
    ownerName: input.ownerName,
    timeOfDay: timeOfDayBucket(now),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    lastWalkHoursAgo,
    todayWalkMinutes,
    streakDays,
    lastMood: lastDailyState?.mood ?? null,
    lastMotorState: lastDailyState?.motorState ?? null,
    weather,
  };
}

/**
 * Diagnostic helper for the in-chat "OpenMeteo" command. Resolves the same
 * coords as `assembleContextForPrompt` would and returns the *uncached*
 * Open-Meteo response so the operator can see the upstream data verbatim.
 */
export async function assembleWeatherDebug(
  input: { userId: string; lat?: number; lng?: number },
): Promise<WeatherDebugSnapshot> {
  let coords: WeatherDebugSnapshot['coords'] = null;
  if (input.lat != null && input.lng != null) {
    coords = { lat: input.lat, lng: input.lng, source: 'input' };
  } else {
    const latestWalkPath = await prisma.walkSession.findFirst({
      where: { userId: input.userId },
      orderBy: { endedAt: 'desc' },
      select: { pathSegments: true },
    });
    const point = extractLatestPoint(latestWalkPath?.pathSegments);
    if (point) coords = { lat: point.lat, lng: point.lng, source: 'last_walk' };
  }
  if (!coords) return { coords: null, weather: { raw: null, description: null } };
  const weather = await getWeatherSnapshot(coords.lat, coords.lng);
  return { coords, weather };
}

/** Pulls the last GPS fix out of the stored pathSegments JSON blob. */
function extractLatestPoint(pathSegments: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(pathSegments)) return null;
  for (let i = pathSegments.length - 1; i >= 0; i--) {
    const segment = pathSegments[i];
    if (
      segment &&
      typeof segment === 'object' &&
      'points' in segment &&
      Array.isArray((segment as { points: unknown }).points)
    ) {
      const points = (segment as { points: unknown[] }).points;
      for (let j = points.length - 1; j >= 0; j--) {
        const point = points[j];
        if (
          point &&
          typeof point === 'object' &&
          'latitude' in point &&
          'longitude' in point &&
          typeof (point as { latitude: unknown }).latitude === 'number' &&
          typeof (point as { longitude: unknown }).longitude === 'number'
        ) {
          return {
            lat: (point as { latitude: number }).latitude,
            lng: (point as { longitude: number }).longitude,
          };
        }
      }
    }
  }
  return null;
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
