import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
} from '@parkwalk/shared';

import { api } from './apiClient';

/** Auth calls can cold-hit Prisma + DB; 8s global axios timeout is too tight on first request. */
const AUTH_TIMEOUT_MS = 20_000;

export async function register(input: RegisterRequest): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/api/v1/auth/register', input, {
    timeout: AUTH_TIMEOUT_MS,
  });
  return data;
}

export async function login(input: LoginRequest): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/api/v1/auth/login', input, {
    timeout: AUTH_TIMEOUT_MS,
  });
  return data;
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post('/api/v1/auth/logout', { refreshToken }, { timeout: AUTH_TIMEOUT_MS });
}
