import type { AuthUser, TokenPair } from '@parkwalk/shared';
import { create } from 'zustand';

import { clearUserScopedQueryCache } from '@/services/queryClient';
import { clearTokens, loadTokens, loadUser, saveAuthSession } from '@/services/secureStorage';

interface AuthState {
  user: AuthUser | null;
  tokens: TokenPair | null;
  isAuthenticated: boolean;
  postRegisterOnboardingPending: boolean;
  hydrate: () => Promise<void>;
  setAuthenticated: (
    user: AuthUser,
    tokens: TokenPair,
    options?: { postRegisterOnboardingPending?: boolean },
  ) => Promise<void>;
  setTokens: (tokens: TokenPair) => void;
  completePostRegisterOnboarding: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tokens: null,
  isAuthenticated: false,
  postRegisterOnboardingPending: false,
  hydrate: async () => {
    const [stored, user] = await Promise.all([loadTokens(), loadUser()]);
    if (stored && user) {
      set({
        user,
        tokens: stored,
        isAuthenticated: true,
        postRegisterOnboardingPending: false,
      });
      return;
    }
    if (stored && !user) {
      await clearTokens();
    }
    set({ user: null, tokens: null, isAuthenticated: false, postRegisterOnboardingPending: false });
  },
  setAuthenticated: async (user, tokens, options) => {
    await saveAuthSession(tokens, user);
    clearUserScopedQueryCache();
    set({
      user,
      tokens,
      isAuthenticated: true,
      postRegisterOnboardingPending: options?.postRegisterOnboardingPending ?? false,
    });
  },
  setTokens: (tokens) => {
    set({ tokens });
  },
  completePostRegisterOnboarding: () => {
    set({ postRegisterOnboardingPending: false });
  },
  logout: async () => {
    await clearTokens();
    clearUserScopedQueryCache();
    set({ user: null, tokens: null, isAuthenticated: false, postRegisterOnboardingPending: false });
  },
}));
