import type { GusNotificationCategory, GusPrefs } from '@parkwalk/shared';
import { pickStockLine } from '@parkwalk/shared';

import { readNotificationStatus } from './permissions';

import { fetchGusPrefs } from '@/services/gusApi';
import { useGusStore } from '@/stores/gusStore';

const GUS_NOTIFICATION_PREFIX = 'gus.';
const CHANNEL_ID = 'gus-reminders';
const POST_WALK_DELAY_MS = 10 * 60 * 1000;
const TEST_DELAY_MS = 15 * 1000;

export type NotificationScheduleResult =
  | { scheduled: true }
  | {
      scheduled: false;
      reason: 'unavailable' | 'permission_denied' | 'prefs_missing' | 'disabled' | 'quiet_hours';
    };

type NotifeeApi = {
  createChannel?: (channel: { id: string; name: string; importance?: number }) => Promise<string>;
  createTriggerNotification: (notification: unknown, trigger: unknown) => Promise<string>;
  cancelNotification: (id: string) => Promise<void>;
  getTriggerNotificationIds: () => Promise<string[]>;
  AndroidImportance?: { HIGH?: number };
  RepeatFrequency: { DAILY: number };
  TriggerType: { TIMESTAMP: number };
};

type NotifeeNativeApi = Pick<
  NotifeeApi,
  'createChannel' | 'createTriggerNotification' | 'cancelNotification' | 'getTriggerNotificationIds'
>;

type NotifeeModule = {
  default?: NotifeeNativeApi;
  AndroidImportance?: NotifeeApi['AndroidImportance'];
  RepeatFrequency?: NotifeeApi['RepeatFrequency'];
  TriggerType?: NotifeeApi['TriggerType'];
} & Partial<NotifeeNativeApi>;

let notifeeCache: NotifeeApi | null | undefined;
function tryLoadNotifee(): NotifeeApi | null {
  if (notifeeCache !== undefined) return notifeeCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@notifee/react-native') as NotifeeModule;
    const nativeApi = mod.default ?? mod;
    if (
      !nativeApi.createTriggerNotification ||
      !nativeApi.cancelNotification ||
      !nativeApi.getTriggerNotificationIds ||
      !mod.RepeatFrequency ||
      !mod.TriggerType
    ) {
      notifeeCache = null;
      return notifeeCache;
    }
    notifeeCache = {
      createChannel: nativeApi.createChannel?.bind(nativeApi),
      createTriggerNotification: nativeApi.createTriggerNotification.bind(nativeApi),
      cancelNotification: nativeApi.cancelNotification.bind(nativeApi),
      getTriggerNotificationIds: nativeApi.getTriggerNotificationIds.bind(nativeApi),
      AndroidImportance: mod.AndroidImportance,
      RepeatFrequency: mod.RepeatFrequency,
      TriggerType: mod.TriggerType,
    };
  } catch {
    notifeeCache = null;
  }
  return notifeeCache;
}

export async function rescheduleAllGusNotifications(): Promise<NotificationScheduleResult> {
  const api = tryLoadNotifee();
  if (!api) return { scheduled: false, reason: 'unavailable' };
  const status = await readNotificationStatus();
  if (status !== 'authorized' && status !== 'provisional') {
    return { scheduled: false, reason: status === 'unavailable' ? 'unavailable' : 'permission_denied' };
  }

  const prefs = await loadPrefs();
  if (!prefs) return { scheduled: false, reason: 'prefs_missing' };

  await cancelGusNotifications(api, ['morning_check_in', 'walk_reminder']);
  await ensureChannel(api);

  let scheduledAny = false;
  if (prefs.morningEnabled && !isTimeInQuietHours(prefs.morningCheckInTime, prefs)) {
    await scheduleDaily(api, 'morning_check_in', prefs.morningCheckInTime);
    scheduledAny = true;
  }
  if (prefs.walkEnabled && !isTimeInQuietHours(prefs.walkReminderTime, prefs)) {
    await scheduleDaily(api, 'walk_reminder', prefs.walkReminderTime);
    scheduledAny = true;
  }
  return scheduledAny ? { scheduled: true } : { scheduled: false, reason: 'quiet_hours' };
}

export async function schedulePostWalkDebrief(
  delayMs = POST_WALK_DELAY_MS,
): Promise<NotificationScheduleResult> {
  const api = tryLoadNotifee();
  if (!api) return { scheduled: false, reason: 'unavailable' };
  const status = await readNotificationStatus();
  if (status !== 'authorized' && status !== 'provisional') {
    return { scheduled: false, reason: status === 'unavailable' ? 'unavailable' : 'permission_denied' };
  }

  const prefs = await loadPrefs();
  if (!prefs) return { scheduled: false, reason: 'prefs_missing' };
  if (!prefs.postWalkEnabled) return { scheduled: false, reason: 'disabled' };

  const timestamp = Date.now() + delayMs;
  if (isDateInQuietHours(new Date(timestamp), prefs)) {
    return { scheduled: false, reason: 'quiet_hours' };
  }

  await cancelGusNotifications(api, ['post_walk_debrief']);
  await ensureChannel(api);
  await scheduleOnce(api, 'post_walk_debrief', timestamp, notificationId('post_walk_debrief'));
  return { scheduled: true };
}

export async function scheduleTestGusNotification(
  category: GusNotificationCategory,
  delayMs = TEST_DELAY_MS,
): Promise<NotificationScheduleResult> {
  const api = tryLoadNotifee();
  if (!api) return { scheduled: false, reason: 'unavailable' };
  const status = await readNotificationStatus();
  if (status !== 'authorized' && status !== 'provisional') {
    return { scheduled: false, reason: status === 'unavailable' ? 'unavailable' : 'permission_denied' };
  }

  await ensureChannel(api);
  await scheduleOnce(api, category, Date.now() + delayMs, `${GUS_NOTIFICATION_PREFIX}test.${category}`);
  return { scheduled: true };
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
  await api.createChannel({
    id: CHANNEL_ID,
    name: 'Gus reminders',
    importance: api.AndroidImportance?.HIGH,
  });
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
    ios: { foregroundPresentationOptions: { alert: true, badge: true, sound: true } },
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
