import type {
  SyncWalkRequest,
  SyncWalkResponse,
  WalkDetailResponse,
  WalkListResponse,
  WalkSession,
} from '@parkwalk/shared';

import { api } from './apiClient';

const WALK_SYNC_TIMEOUT_MS = 20_000;

export async function syncWalk(request: SyncWalkRequest): Promise<WalkSession> {
  const { data } = await api.post<SyncWalkResponse>('/api/v1/walks', request, {
    timeout: WALK_SYNC_TIMEOUT_MS,
  });
  return data.walk;
}

export async function fetchWalks(): Promise<Omit<WalkSession, 'pathSegments'>[]> {
  const { data } = await api.get<WalkListResponse>('/api/v1/walks');
  return data.items;
}

export async function fetchWalk(id: string): Promise<WalkSession> {
  const { data } = await api.get<WalkDetailResponse>(`/api/v1/walks/${id}`);
  return data.walk;
}
