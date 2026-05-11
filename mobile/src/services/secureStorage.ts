import type { AuthUser } from '@parkwalk/shared';
import * as Keychain from 'react-native-keychain';

const SERVICE = 'parkwalk.auth';
const USER_SERVICE = 'parkwalk.auth.user';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function saveAuthSession(tokens: StoredTokens, user: AuthUser): Promise<void> {
  await Promise.all([saveTokens(tokens), saveUser(user)]);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const result = await Keychain.getGenericPassword({ service: SERVICE });
  if (!result) return null;
  try {
    return JSON.parse(result.password) as StoredTokens;
  } catch {
    return null;
  }
}

export async function saveUser(user: AuthUser): Promise<void> {
  await Keychain.setGenericPassword('user', JSON.stringify(user), {
    service: USER_SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function loadUser(): Promise<AuthUser | null> {
  const result = await Keychain.getGenericPassword({ service: USER_SERVICE });
  if (!result) return null;
  try {
    return JSON.parse(result.password) as AuthUser;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    Keychain.resetGenericPassword({ service: SERVICE }),
    Keychain.resetGenericPassword({ service: USER_SERVICE }),
  ]);
}
