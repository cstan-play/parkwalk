import * as Keychain from 'react-native-keychain';

const SERVICE = 'parkwalk.auth';

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

export async function loadTokens(): Promise<StoredTokens | null> {
  const result = await Keychain.getGenericPassword({ service: SERVICE });
  if (!result) return null;
  try {
    return JSON.parse(result.password) as StoredTokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
