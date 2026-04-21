import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { clearTokens, loadTokens, saveTokens } from './secureStorage';

interface RefreshResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
  };
}

interface RetriableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshInFlight: Promise<string | null> | null = null;

export function buildApiClient(): AxiosInstance {
  const baseURL = useSettingsStore.getState().apiBaseUrl;
  const client = axios.create({
    baseURL,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use(async (req) => {
    const base = useSettingsStore.getState().apiBaseUrl;
    req.baseURL = base;
    const token = useAuthStore.getState().tokens?.accessToken;
    if (token) req.headers.Authorization = `Bearer ${token}`;
    return req;
  });

  client.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const original = error.config as RetriableRequest | undefined;
      if (!original || error.response?.status !== 401 || original._retry) {
        return Promise.reject(error);
      }
      original._retry = true;

      const newAccessToken = await getFreshAccessToken();
      if (!newAccessToken) return Promise.reject(error);
      if (original.headers) {
        original.headers.Authorization = `Bearer ${newAccessToken}`;
      }
      return client.request(original);
    },
  );

  return client;
}

async function getFreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const stored = await loadTokens();
      if (!stored) return null;
      const base = useSettingsStore.getState().apiBaseUrl;
      const res = await axios.post<RefreshResponse>(`${base}/api/v1/auth/refresh`, {
        refreshToken: stored.refreshToken,
      });
      const next = res.data.tokens;
      await saveTokens(next);
      useAuthStore.getState().setTokens(next);
      return next.accessToken;
    } catch {
      await clearTokens();
      useAuthStore.getState().logout();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const api = buildApiClient();
