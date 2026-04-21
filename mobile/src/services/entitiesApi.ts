import type {
  CollectRequest,
  CollectResponse,
  GameEntity,
  NearbyQuery,
} from '@parkwalk/shared';

import { api } from './apiClient';

export async function fetchNearby(params: NearbyQuery): Promise<GameEntity[]> {
  const { data } = await api.get<{ items: GameEntity[] }>('/api/v1/entities/nearby', {
    params,
  });
  return data.items;
}

export async function collectEntity(
  idempotencyKey: string,
  request: CollectRequest,
): Promise<CollectResponse> {
  const { data } = await api.post<CollectResponse>('/api/v1/entities/collect', request, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}
