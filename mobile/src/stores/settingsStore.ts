import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import { create } from 'zustand';

import { RAILWAY_PUBLIC_API_ORIGIN } from '@/config/railwayPublicApi';

const STORAGE_KEY = 'parkwalk.settings.v2';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function requireHttpsApiUrl(url: string, source: string): string {
  const normalized = stripTrailingSlash(url.trim());
  if (!normalized.startsWith('https://')) {
    throw new Error(`${source} must use https://`);
  }
  const hostAndPath = normalized.slice('https://'.length);
  const host = hostAndPath.split('/')[0] ?? '';
  if (!host || host.includes(' ') || !host.includes('.')) {
    throw new Error(`${source} must be a valid HTTPS URL`);
  }
  return normalized;
}

export function normalizeApiBaseUrl(url: string): string {
  return requireHttpsApiUrl(url, 'API base URL');
}

function buildTimeApiBaseUrl(): string {
  const env = (Config.API_BASE_URL ?? '').trim();
  if (env) return requireHttpsApiUrl(env, 'API_BASE_URL');
  const railway = (RAILWAY_PUBLIC_API_ORIGIN ?? '').trim();
  if (railway) return requireHttpsApiUrl(railway, 'RAILWAY_PUBLIC_API_ORIGIN');
  throw new Error('RAILWAY_PUBLIC_API_ORIGIN or HTTPS API_BASE_URL is required');
}

function readStoredHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return normalizeApiBaseUrl(value);
  } catch {
    return null;
  }
}

interface Settings {
  apiBaseUrl: string;
  savedApiUrl: string;
}

interface SettingsState extends Settings {
  hydrate: () => Promise<void>;
  setApiBaseUrl: (url: string) => Promise<void>;
  setSavedApiUrl: (url: string) => Promise<void>;
}

const DEFAULTS: Settings = {
  apiBaseUrl: buildTimeApiBaseUrl(),
  savedApiUrl: buildTimeApiBaseUrl(),
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrate: async () => {
    try {
      const fromBuild = buildTimeApiBaseUrl();
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Settings> & Record<string, unknown>;
      const prev = get();
      const storedApiBaseUrl = readStoredHttpsUrl(parsed.apiBaseUrl);
      const storedSavedApiUrl = readStoredHttpsUrl(parsed.savedApiUrl);
      const merged: Settings = {
        apiBaseUrl: storedApiBaseUrl ?? fromBuild,
        savedApiUrl: storedSavedApiUrl ?? storedApiBaseUrl ?? prev.savedApiUrl,
      };
      set({ ...prev, ...merged });
    } catch {
      // noop
    }
  },
  setApiBaseUrl: async (url) => {
    set({ apiBaseUrl: normalizeApiBaseUrl(url) });
    await persist(get());
  },
  setSavedApiUrl: async (url) => {
    set({ savedApiUrl: normalizeApiBaseUrl(url) });
    await persist(get());
  },
}));

async function persist(state: Settings): Promise<void> {
  const payload: Settings = {
    apiBaseUrl: state.apiBaseUrl,
    savedApiUrl: state.savedApiUrl,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
