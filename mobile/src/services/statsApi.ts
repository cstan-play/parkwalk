import type { UserStats } from '@parkwalk/shared';

import { api } from './apiClient';

export async function fetchMyStats(): Promise<UserStats> {
  const { data } = await api.get<{ stats: UserStats }>('/api/v1/users/me/stats');
  return data.stats;
}
