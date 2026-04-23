import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import { create } from 'zustand';

import { RAILWAY_PUBLIC_API_ORIGIN } from '@/config/railwayPublicApi';

const STORAGE_KEY = 'parkwalk.settings.v1';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function isLoopbackApiUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/** Typical dev URLs that should migrate to Railway when this build ships a public API default. */
function isLikelyLanDevUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    const h = u.hostname;
    if (h.startsWith('192.168.')) return true;
    if (h.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  } catch {
    return false;
  }
}

function buildTimeApiBaseUrl(): string {
  const env = (Config.API_BASE_URL ?? '').trim();
  if (env) return stripTrailingSlash(env);
  const railway = (RAILWAY_PUBLIC_API_ORIGIN ?? '').trim();
  if (railway) return stripTrailingSlash(railway);
  return 'http://127.0.0.1:3000';
}

interface Settings {
  apiBaseUrl: string;
  savedLanUrl: string;
  savedNgrokUrl: string;
  savedProdUrl: string;
}

interface SettingsState extends Settings {
  hydrate: () => Promise<void>;
  setApiBaseUrl: (url: string) => Promise<void>;
  setSavedUrl: (key: 'savedLanUrl' | 'savedNgrokUrl' | 'savedProdUrl', url: string) => Promise<void>;
}

const DEFAULTS: Settings = {
  apiBaseUrl: buildTimeApiBaseUrl(),
  savedLanUrl: 'http://192.168.1.10:3000',
  savedNgrokUrl: '',
  savedProdUrl: (RAILWAY_PUBLIC_API_ORIGIN ?? '').trim()
    ? stripTrailingSlash(RAILWAY_PUBLIC_API_ORIGIN.trim())
    : '',
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrate: async () => {
    try {
      const fromBuild = buildTimeApiBaseUrl();
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const prev = get();
      const merged: Settings = {
        apiBaseUrl: parsed.apiBaseUrl ?? prev.apiBaseUrl,
        savedLanUrl: parsed.savedLanUrl ?? prev.savedLanUrl,
        savedNgrokUrl: parsed.savedNgrokUrl ?? prev.savedNgrokUrl,
        savedProdUrl: parsed.savedProdUrl ?? prev.savedProdUrl,
      };
      // Prefer this build's API URL when stored settings still point at loopback,
      // LAN, or ngrok-style dev hosts and the build provides a real public URL.
      const shouldMigrateToBuildDefault =
        !isLoopbackApiUrl(fromBuild) &&
        (isLoopbackApiUrl(merged.apiBaseUrl) ||
          isLikelyLanDevUrl(merged.apiBaseUrl) ||
          merged.apiBaseUrl.includes('ngrok'));
      if (shouldMigrateToBuildDefault) {
        merged.apiBaseUrl = fromBuild;
        if ((RAILWAY_PUBLIC_API_ORIGIN ?? '').trim()) {
          merged.savedProdUrl = stripTrailingSlash(RAILWAY_PUBLIC_API_ORIGIN.trim());
        }
        await persist(merged);
      }
      set({ ...prev, ...merged });
    } catch {
      // noop
    }
  },
  setApiBaseUrl: async (url) => {
    set({ apiBaseUrl: url });
    await persist(get());
  },
  setSavedUrl: async (key, url) => {
    set({ [key]: url } as Pick<Settings, typeof key>);
    await persist(get());
  },
}));

async function persist(state: Settings): Promise<void> {
  const payload: Settings = {
    apiBaseUrl: state.apiBaseUrl,
    savedLanUrl: state.savedLanUrl,
    savedNgrokUrl: state.savedNgrokUrl,
    savedProdUrl: state.savedProdUrl,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
