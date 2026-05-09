import type { GusNotificationCategory, GusPrefs } from '@parkwalk/shared';
import { pickStockLine } from '@parkwalk/shared';

import { fetchGusPrefs } from '@/services/gusApi';
import { useGusStore } from '@/stores/gusStore';

import { readNotificationStatus } from './permissions';

const GUS_NOTIFICATION_PREFIX = 'gus.';
const CHANNEL_ID = 'gus-reminders';
const POST_WALK_DELAY_MS = 10 * 60 * 1000;
const TEST_DELAY_MS = 30 * 1000;

type NotifeeApi = {
  createChannel?: (channel: { id: string; name: string }) => Promise<string>;
  createTriggerNotification: (notification: unknown, trigger: unknown) => Promise<string>;
  cancelNotification: (id: string) => Promise<void>;
  getTriggerNotificationIds: () => Promise<string[]>;
  RepeatFrequency: { DAILY: number };
  TriggerType: { TIMESTAMP: number };
};

let notifeeCache: NotifeeApi | null | undefined;
function tryLoadNotifee(): NotifeeApi | null {
  if (notifeeCache !== undefined) return notifeeCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@notifee/react-native');
    notifeeCache = (mod.default ?? mod) as NotifeeApi;
  } catch {
    notifeeCache = null;
  }
  return notifeeCache;
}

export async function rescheduleAllGusNotifications(): Promise<void> {
  const api = tryLoadNotifee();
  if (!api) return;
  const status = await readNotificationStatus();
  if (status !== 'authorized' && status !== 'provisional') return;

  const prefs = await loadPrefs();
  if (!prefs) return;

  await cancelGusNotifications(api, ['morning_check_in', 'walk_reminder']);
  await ensureChannel(api);

  if (prefs.morningEnabled && !isTimeInQuietHours(prefs.morningCheckInTime, prefs)) {
    await scheduleDaily(api, 'morning_check_in', prefs.morningCheckInTime);
  }
  if (prefs.walkEnabled && !isTimeInQuietHours(prefs.walkReminderTime, prefs)) {
    await scheduleDaily(api, 'walk_reminder', prefs.walkReminderTime);
  }
}

export async function schedulePostWalkDebrief(delayMs = POST_WALK_DELAY_MS): Promise<void> {
  const api = tryLoadNotifee();
  if (!api) return;
  const status = await readNotificationStatus();
  if (status !== 'authorized' && status !== 'provisional') return;

  const prefs = await loadPrefs();
  if (!prefs?.postWalkEnabled) return;

  const timestamp = Date.now() + delayMs;
  if (isDateInQuietHours(new Date(timestamp), prefs)) return;

  await cancelGusNotifications(api, ['post_walk_debrief']);
  await ensureChannel(api);
  await scheduleOnce(api, 'post_walk_debrief', timestamp, notificationId('post_walk_debrief'));
}

export async function scheduleTestGusNotification(
  category: GusNotificationCategory,
  delayMs = TEST_DELAY_MS,
): Promise<void> {
  const api = tryLoadNotifee();
  if (!api) return;
  const status = await readNotificationStatus();
  if (status !== 'authorized' && status !== 'provisional') return;

  await ensureChannel(api);
  await scheduleOnce(api, category, Date.now() + delayMs, `${GUS_NOTIFICATION_PREFIX}test.${category}`);
}

async function loadPrefs(): Promise<GusPrefs | null> {
  const cached = useGusStore.getState().prefs;
  if (cached) return cached;
  try {
    const prefs = await fetchGusPrefs();
    useGusStore.setState({ prefs });
    return prefs;
  } catch {
    return null;
  }
}

async function ensureChannel(api: NotifeeApi): Promise<void> {
  if (!api.createChannel) return;
  await api.createChannel({ id: CHANNEL_ID, name: 'Gus reminders' });
}

async function cancelGusNotifications(
  api: NotifeeApi,
  categories?: GusNotificationCategory[],
): Promise<void> {
  const ids = await api.getTriggerNotificationIds();
  const allowed = categories ? new Set(categories.map(notificationId)) : null;
  await Promise.all(
    ids
      .filter((id) => id.startsWith(GUS_NOTIFICATION_PREFIX))
      .filter((id) => !allowed || allowed.has(id))
      .map((id) => api.cancelNotification(id)),
  );
}

async function scheduleDaily(
  api: NotifeeApi,
  category: GusNotificationCategory,
  hhmm: string,
): Promise<void> {
  const timestamp = nextTimestampForTime(hhmm);
  const trigger = {
    type: api.TriggerType.TIMESTAMP,
    timestamp,
    repeatFrequency: api.RepeatFrequency.DAILY,
  };
  await api.createTriggerNotification(notificationPayload(category, notificationId(category)), trigger);
}

async function scheduleOnce(
  api: NotifeeApi,
  category: GusNotificationCategory,
  timestamp: number,
  id: string,
): Promise<void> {
  const trigger = { type: api.TriggerType.TIMESTAMP, timestamp };
  await api.createTriggerNotification(notificationPayload(category, id), trigger);
}

function notificationPayload(category: GusNotificationCategory, id: string): unknown {
  return {
    id,
    title: 'Gus',
    body: pickStockLine(category, null) ?? fallbackBody(category),
    data: { category },
    android: { channelId: CHANNEL_ID, pressAction: { id: 'default' } },
  };
}

function notificationId(category: GusNotificationCategory): string {
  return `${GUS_NOTIFICATION_PREFIX}${category}`;
}

function fallbackBody(category: GusNotificationCategory): string {
  switch (category) {
    case 'morning_check_in':
      return 'Up. Now. - Gus';
    case 'walk_reminder':
      return "The lamppost isn't going to sniff itself.";
    case 'post_walk_debrief':
      return 'Back. I have thoughts.';
  }
}

function nextTimestampForTime(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function isTimeInQuietHours(hhmm: string, prefs: GusPrefs): boolean {
  return isMinutesInQuietHours(toMinutes(hhmm), toMinutes(prefs.quietHoursStart), toMinutes(prefs.quietHoursEnd));
}

function isDateInQuietHours(date: Date, prefs: GusPrefs): boolean {
  return isMinutesInQuietHours(
    date.getHours() * 60 + date.getMinutes(),
    toMinutes(prefs.quietHoursStart),
    toMinutes(prefs.quietHoursEnd),
  );
}

function isMinutesInQuietHours(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

function toMinutes(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
