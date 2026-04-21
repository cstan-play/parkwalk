import type { AuthUser, TokenPair } from '@parkwalk/shared';
import { create } from 'zustand';

import { clearTokens, loadTokens, saveTokens } from '@/services/secureStorage';

interface AuthState {
  user: AuthUser | null;
  tokens: TokenPair | null;
  isAuthenticated: boolean;
  hydrate: () => Promise<void>;
  setAuthenticated: (user: AuthUser, tokens: TokenPair) => Promise<void>;
  setTokens: (tokens: TokenPair) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tokens: null,
  isAuthenticated: false,
  hydrate: async () => {
    const stored = await loadTokens();
    if (stored) {
      set({
        tokens: stored,
        isAuthenticated: true,
      });
    }
  },
  setAuthenticated: async (user, tokens) => {
    await saveTokens(tokens);
    set({ user, tokens, isAuthenticated: true });
  },
  setTokens: (tokens) => {
    set({ tokens });
  },
  logout: async () => {
    await clearTokens();
    set({ user: null, tokens: null, isAuthenticated: false });
  },
}));
