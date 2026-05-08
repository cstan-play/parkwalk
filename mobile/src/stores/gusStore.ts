import type { DogProfile, GusPrefs, UpsertDogProfileRequest, UpsertGusPrefsRequest } from '@parkwalk/shared';
import { create } from 'zustand';

import {
  fetchDogProfile,
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
  hydrating: boolean;
  hydrate: () => Promise<void>;
  saveProfile: (patch: UpsertDogProfileRequest) => Promise<DogProfile>;
  savePrefs: (patch: UpsertGusPrefsRequest) => Promise<GusPrefs>;
  reset: () => void;
}

export const useGusStore = create<GusStoreState>((set) => ({
  profile: null,
  prefs: null,
  hydrating: false,
  hydrate: async () => {
    set({ hydrating: true });
    try {
      const [profile, prefs] = await Promise.all([fetchDogProfile(), fetchGusPrefs()]);
      set({ profile, prefs, hydrating: false });
    } catch {
      set({ hydrating: false });
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
  reset: () => set({ profile: null, prefs: null, hydrating: false }),
}));
