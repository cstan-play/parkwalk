import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
} from '@parkwalk/shared';

import { api } from './apiClient';

export async function register(input: RegisterRequest): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/api/v1/auth/register', input);
  return data;
}

export async function login(input: LoginRequest): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/api/v1/auth/login', input);
  return data;
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post('/api/v1/auth/logout', { refreshToken });
}
