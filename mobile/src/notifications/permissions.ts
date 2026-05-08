import { useEffect, useState } from 'react';

/**
 * Thin wrapper around notifee's notification permission. Sprint 0 only
 * needs the request flow during onboarding; the scheduler (Sprint 3)
 * also reads the status before scheduling triggers.
 *
 * notifee is dynamically required so the app still boots in environments
 * where the native module isn't installed yet (e.g. before `pod install`).
 */
type AuthStatus = 'unknown' | 'authorized' | 'denied' | 'provisional' | 'unavailable';

interface NotifeeApi {
  requestPermission: () => Promise<{ authorizationStatus: number }>;
  getNotificationSettings: () => Promise<{ authorizationStatus: number }>;
  AuthorizationStatus: {
    NOT_DETERMINED: number;
    DENIED: number;
    AUTHORIZED: number;
    PROVISIONAL: number;
  };
}

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

function mapStatus(api: NotifeeApi, raw: number): AuthStatus {
  if (raw === api.AuthorizationStatus.AUTHORIZED) return 'authorized';
  if (raw === api.AuthorizationStatus.PROVISIONAL) return 'provisional';
  if (raw === api.AuthorizationStatus.DENIED) return 'denied';
  return 'unknown';
}

export async function requestNotificationPermission(): Promise<AuthStatus> {
  const api = tryLoadNotifee();
  if (!api) return 'unavailable';
  const result = await api.requestPermission();
  return mapStatus(api, result.authorizationStatus);
}

export async function readNotificationStatus(): Promise<AuthStatus> {
  const api = tryLoadNotifee();
  if (!api) return 'unavailable';
  const result = await api.getNotificationSettings();
  return mapStatus(api, result.authorizationStatus);
}

export function useNotificationPermission(): {
  status: AuthStatus;
  loading: boolean;
  request: () => Promise<void>;
} {
  const [status, setStatus] = useState<AuthStatus>('unknown');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await readNotificationStatus();
      if (alive) {
        setStatus(next);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function request(): Promise<void> {
    setLoading(true);
    const next = await requestNotificationPermission();
    setStatus(next);
    setLoading(false);
  }

  return { status, loading, request };
}
