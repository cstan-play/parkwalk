import type {
  DogProfile,
  GusModelOption,
  GusModelsResponse,
  GusPrefs,
  UpsertDogProfileRequest,
  UpsertGusPrefsRequest,
} from '@parkwalk/shared';
import { create } from 'zustand';

import {
  fetchDogProfile,
  fetchGusModels,
  fetchGusPrefs,
  upsertDogProfile as apiUpsertProfile,
  upsertGusPrefs as apiUpsertPrefs,
} from '@/services/gusApi';

/**
 * In-memory mirror of the user's dog profile + Gus prefs. Server is source
 * of truth; this store hydrates from the server after auth and refreshes
 * after edits. Persistence is deliberately NOT wired to AsyncStorage — if
 * the cache is empty after launch, the screen that needs the data calls
 * `hydrate()`. Mirrors the scalar+setter shape used in `settingsStore`.
 */
interface GusStoreState {
  profile: DogProfile | null;
  prefs: GusPrefs | null;
  models: GusModelOption[];
  modelProvider: GusModelsResponse['provider'] | null;
  configuredChatModel: string | null;
  configuredNotificationModel: string | null;
  hydrating: boolean;
  loadingModels: boolean;
  hydrate: () => Promise<void>;
  loadModels: () => Promise<void>;
  saveProfile: (patch: UpsertDogProfileRequest) => Promise<DogProfile>;
  savePrefs: (patch: UpsertGusPrefsRequest) => Promise<GusPrefs>;
  reset: () => void;
}

export const useGusStore = create<GusStoreState>((set) => ({
  profile: null,
  prefs: null,
  models: [],
  modelProvider: null,
  configuredChatModel: null,
  configuredNotificationModel: null,
  hydrating: false,
  loadingModels: false,
  hydrate: async () => {
    set({ hydrating: true });
    try {
      const [profile, prefs] = await Promise.all([fetchDogProfile(), fetchGusPrefs()]);
      set({ profile, prefs, hydrating: false });
    } catch {
      set({ hydrating: false });
    }
  },
  loadModels: async () => {
    set({ loadingModels: true });
    try {
      const result = await fetchGusModels();
      set({
        models: result.items,
        modelProvider: result.provider,
        configuredChatModel: result.chatModel,
        configuredNotificationModel: result.notificationModel,
        loadingModels: false,
      });
    } catch {
      set({ loadingModels: false });
    }
  },
  saveProfile: async (patch) => {
    const profile = await apiUpsertProfile(patch);
    set({ profile });
    return profile;
  },
  savePrefs: async (patch) => {
    const prefs = await apiUpsertPrefs(patch);
    set({ prefs });
    return prefs;
  },
  reset: () =>
    set({
      profile: null,
      prefs: null,
      models: [],
      modelProvider: null,
      configuredChatModel: null,
      configuredNotificationModel: null,
      hydrating: false,
      loadingModels: false,
    }),
}));
