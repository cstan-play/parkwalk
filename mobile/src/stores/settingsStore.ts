import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import { create } from 'zustand';

const STORAGE_KEY = 'parkwalk.settings.v1';

function isLoopbackApiUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
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
  apiBaseUrl: Config.API_BASE_URL ?? 'http://127.0.0.1:3000',
  savedLanUrl: Config.API_BASE_URL ?? 'http://192.168.1.10:3000',
  savedNgrokUrl: '',
  savedProdUrl: '',
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrate: async () => {
    try {
      const fromConfig = (Config.API_BASE_URL ?? '').trim() || DEFAULTS.apiBaseUrl;
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
      // Simulator often used 127.0.0.1; that persists to AsyncStorage and then
      // breaks on a real device (the phone is not your Mac). Prefer the LAN URL
      // from the current build's .env when we detect loopback.
      if (isLoopbackApiUrl(merged.apiBaseUrl) && fromConfig && !isLoopbackApiUrl(fromConfig)) {
        merged.apiBaseUrl = fromConfig;
        merged.savedLanUrl = fromConfig;
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
