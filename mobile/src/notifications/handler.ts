import type { GusNotificationCategory } from '@parkwalk/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { navigateToChat, navigationRef } from '@/navigation/navigationRef';
import { useChatStore } from '@/stores/chatStore';

const PENDING_CATEGORY_KEY = 'parkwalk.gus.pending_notification_category';

type NotifeeEvent = {
  type: number;
  detail: { notification?: { data?: Record<string, unknown> } };
};

type NotifeeApi = {
  EventType: { PRESS: number };
  onForegroundEvent: (handler: (event: NotifeeEvent) => void) => () => void;
  onBackgroundEvent: (handler: (event: NotifeeEvent) => Promise<void>) => void;
  getInitialNotification?: () => Promise<{ notification?: { data?: Record<string, unknown> } } | null>;
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

export function registerGusForegroundNotificationHandler(): () => void {
  const api = tryLoadNotifee();
  if (!api) return () => undefined;

  return api.onForegroundEvent((event) => {
    if (event.type !== api.EventType.PRESS) return;
    const category = parseCategory(event.detail.notification?.data?.category);
    if (category) void openChatForCategory(category);
  });
}

export function registerGusBackgroundNotificationHandler(): void {
  const api = tryLoadNotifee();
  if (!api) return;

  api.onBackgroundEvent(async (event) => {
    if (event.type !== api.EventType.PRESS) return;
    const category = parseCategory(event.detail.notification?.data?.category);
    if (category) await AsyncStorage.setItem(PENDING_CATEGORY_KEY, category);
  });
}

export async function consumeInitialGusNotification(): Promise<void> {
  const api = tryLoadNotifee();
  const initial = api?.getInitialNotification ? await api.getInitialNotification() : null;
  const initialCategory = parseCategory(initial?.notification?.data?.category);
  if (initialCategory) {
    await openChatForCategory(initialCategory);
    return;
  }

  const pending = parseCategory(await AsyncStorage.getItem(PENDING_CATEGORY_KEY));
  if (pending) {
    await AsyncStorage.removeItem(PENDING_CATEGORY_KEY);
    await openChatForCategory(pending);
  }
}

async function openChatForCategory(category: GusNotificationCategory): Promise<void> {
  if (!navigationRef.isReady()) {
    await AsyncStorage.setItem(PENDING_CATEGORY_KEY, category);
    return;
  }
  navigateToChat();
  await useChatStore.getState().fireNotification(category);
}

function parseCategory(value: unknown): GusNotificationCategory | null {
  if (
    value === 'morning_check_in' ||
    value === 'walk_reminder' ||
    value === 'post_walk_debrief'
  ) {
    return value;
  }
  return null;
}
