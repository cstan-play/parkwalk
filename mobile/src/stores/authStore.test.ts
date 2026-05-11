import type { AuthUser, TokenPair } from '@parkwalk/shared';
import * as Keychain from 'react-native-keychain';

import { queryClient } from '@/services/queryClient';

import { useAuthStore } from './authStore';

const tokens: TokenPair = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-04-29T11:00:00.000Z',
  refreshTokenExpiresAt: '2026-05-29T11:00:00.000Z',
};

const user: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'tester',
  email: 'tester@example.com',
  displayName: null,
  avatarUrl: null,
  createdAt: '2026-04-29T10:00:00.000Z',
};

describe('authStore persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(queryClient, 'clear').mockImplementation(() => undefined);
    useAuthStore.setState({ user: null, tokens: null, isAuthenticated: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists tokens and user together on login', async () => {
    await useAuthStore.getState().setAuthenticated(user, tokens);

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'tokens',
      JSON.stringify(tokens),
      expect.objectContaining({ service: 'parkwalk.auth' }),
    );
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'user',
      JSON.stringify(user),
      expect.objectContaining({ service: 'parkwalk.auth.user' }),
    );
    expect(useAuthStore.getState()).toMatchObject({ user, tokens, isAuthenticated: true });
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });

  it('clears user-scoped query cache on logout', async () => {
    await useAuthStore.getState().logout();

    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'parkwalk.auth' });
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'parkwalk.auth.user' });
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      tokens: null,
      isAuthenticated: false,
    });
  });

  it('hydrates only when tokens and user are both present', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockImplementation(async ({ service }) => {
      if (service === 'parkwalk.auth') return { username: 'tokens', password: JSON.stringify(tokens) };
      if (service === 'parkwalk.auth.user') return { username: 'user', password: JSON.stringify(user) };
      return null;
    });

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({ user, tokens, isAuthenticated: true });
  });

  it('clears token-only sessions instead of authenticating without an owner id', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockImplementation(async ({ service }) => {
      if (service === 'parkwalk.auth') return { username: 'tokens', password: JSON.stringify(tokens) };
      return null;
    });

    await useAuthStore.getState().hydrate();

    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'parkwalk.auth' });
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'parkwalk.auth.user' });
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      tokens: null,
      isAuthenticated: false,
    });
  });
});
