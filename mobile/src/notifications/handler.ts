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

type NotifeeNativeApi = Pick<
  NotifeeApi,
  'onForegroundEvent' | 'onBackgroundEvent' | 'getInitialNotification'
>;

type NotifeeModule = {
  default?: NotifeeNativeApi;
  EventType?: NotifeeApi['EventType'];
} & Partial<NotifeeNativeApi>;

let notifeeCache: NotifeeApi | null | undefined;
function tryLoadNotifee(): NotifeeApi | null {
  if (notifeeCache !== undefined) return notifeeCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@notifee/react-native') as NotifeeModule;
    const nativeApi = mod.default ?? mod;
    if (!nativeApi.onForegroundEvent || !nativeApi.onBackgroundEvent || !mod.EventType) {
      notifeeCache = null;
      return notifeeCache;
    }
    notifeeCache = {
      onForegroundEvent: nativeApi.onForegroundEvent.bind(nativeApi),
      onBackgroundEvent: nativeApi.onBackgroundEvent.bind(nativeApi),
      getInitialNotification: nativeApi.getInitialNotification?.bind(nativeApi),
      EventType: mod.EventType,
    };
  } catch {
    notifeeCache = null;
  }
  return notifeeCache;
}

/**
 * Notifee Android requires a background event handler to be registered at
 * the top of `index.js`, before AppRegistry.registerComponent. Without it,
 * Android cannot deliver press events when the app is backgrounded or
 * killed — the notification just opens the app without any context.
 *
 * On iOS the press path is `getInitialNotification` (cold launch from a
 * tap) plus `onForegroundEvent` (app already running). The background
 * handler is harmless on iOS — Notifee will simply not invoke it.
 *
 * The handler stashes the category in AsyncStorage; the existing
 * `consumeInitialGusNotification()` picks it up after the app's
 * NavigationContainer is ready.
 */
export function registerGusBackgroundNotificationHandler(): void {
  const api = tryLoadNotifee();
  if (!api) return;

  try {
    api.onBackgroundEvent(async ({ type, detail }) => {
      if (type !== api.EventType.PRESS) return;
      const category = parseCategory(detail.notification?.data?.category);
      if (category) {
        await AsyncStorage.setItem(PENDING_CATEGORY_KEY, category);
      }
    });
  } catch {
    // Notifee may throw if onBackgroundEvent is registered more than once;
    // we accept the no-op since the first registration is the one that
    // matters and re-registration during HMR is benign.
  }
}

export function registerGusForegroundNotificationHandler(): () => void {
  const api = tryLoadNotifee();
  if (!api) return () => undefined;

  try {
    return api.onForegroundEvent((event) => {
      if (event.type !== api.EventType.PRESS) return;
      const category = parseCategory(event.detail.notification?.data?.category);
      if (category) void openChatForCategory(category);
    });
  } catch {
    return () => undefined;
  }
}

export async function consumeInitialGusNotification(): Promise<void> {
  const api = tryLoadNotifee();
  let initial: { notification?: { data?: Record<string, unknown> } } | null = null;
  try {
    initial = api?.getInitialNotification ? await api.getInitialNotification() : null;
  } catch {
    initial = null;
  }
  const initialCategory = parseCategory(initial?.notification?.data?.category);
  if (initialCategory) {
    await AsyncStorage.removeItem(PENDING_CATEGORY_KEY);
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
