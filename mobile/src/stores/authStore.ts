import type { AuthUser, TokenPair } from '@parkwalk/shared';
import { create } from 'zustand';

import { clearUserScopedQueryCache } from '@/services/queryClient';
import { clearTokens, loadTokens, loadUser, saveAuthSession } from '@/services/secureStorage';

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
    const [stored, user] = await Promise.all([loadTokens(), loadUser()]);
    if (stored && user) {
      set({
        user,
        tokens: stored,
        isAuthenticated: true,
      });
      return;
    }
    if (stored && !user) {
      await clearTokens();
    }
    set({ user: null, tokens: null, isAuthenticated: false });
  },
  setAuthenticated: async (user, tokens) => {
    await saveAuthSession(tokens, user);
    clearUserScopedQueryCache();
    set({ user, tokens, isAuthenticated: true });
  },
  setTokens: (tokens) => {
    set({ tokens });
  },
  logout: async () => {
    await clearTokens();
    clearUserScopedQueryCache();
    set({ user: null, tokens: null, isAuthenticated: false });
  },
}));
