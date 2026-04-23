import type {
  CollectRequest,
  CollectResponse,
  GameEntity,
  NearbyQuery,
} from '@parkwalk/shared';

import { api, postWithRetry } from './apiClient';

export async function fetchNearby(params: NearbyQuery): Promise<GameEntity[]> {
  const { data } = await api.get<{ items: GameEntity[] }>('/api/v1/entities/nearby', {
    params,
  });
  return data.items;
}

/**
 * Collect a game entity. Uses the shared idempotency key + retry helper so
 * that a flaky radio/wifi hop doesn't kill an otherwise-valid collect; the
 * server deduplicates on the same key if the first attempt actually landed.
 */
export async function collectEntity(
  idempotencyKey: string,
  request: CollectRequest,
): Promise<CollectResponse> {
  const { data } = await postWithRetry<CollectResponse, CollectRequest>(
    '/api/v1/entities/collect',
    request,
    { idempotencyKey },
  );
  return data;
}
