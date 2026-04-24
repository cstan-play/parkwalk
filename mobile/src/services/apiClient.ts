import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

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

/**
 * Per-attempt HTTP timeout. Previously 15s, which masked flaky connections
 * behind a single long wait. 8s is still generous for a hosted API call
 * (typical collect round-trip is 200-600ms) and leaves headroom for the
 * retry schedule below (total worst-case: 8s + ~400ms + 8s = ~16s, same
 * ballpark as the old single-attempt timeout but with three chances).
 */
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

let refreshInFlight: Promise<string | null> | null = null;

export function buildApiClient(): AxiosInstance {
  const baseURL = useSettingsStore.getState().apiBaseUrl;
  const client = axios.create({
    baseURL,
    timeout: PER_ATTEMPT_TIMEOUT_MS,
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
      const res = await axios.post<RefreshResponse>(
        `${base}/api/v1/auth/refresh`,
        { refreshToken: stored.refreshToken },
        { timeout: 20_000 },
      );
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

/**
 * Exponential backoff schedule (ms), with ±20% jitter, for idempotent
 * mutation retries. Tuned for flaky mobile connectivity where the radio
 * drops a packet.
 *
 *   attempt 1  → 0 ms
 *   attempt 2  → 400 ms   ±20%
 *   attempt 3  → 1200 ms  ±20%
 *
 * Total wall-clock worst case (3 attempts, each hitting the 8s per-attempt
 * timeout, plus backoff): ~25s. In practice a successful retry lands in
 * well under 6s.
 */
const RETRY_BACKOFF_MS = [0, 400, 1200] as const;

/**
 * Listeners for retry events — used by the UI to show "retrying..." state.
 * Keyed by idempotency key so the UI can correlate.
 */
export type RetryEvent = {
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  error: unknown;
};
type RetryListener = (e: RetryEvent) => void;
const retryListeners = new Set<RetryListener>();

export function onRetry(listener: RetryListener): () => void {
  retryListeners.add(listener);
  return () => retryListeners.delete(listener);
}

function emitRetry(e: RetryEvent): void {
  for (const l of retryListeners) {
    try {
      l(e);
    } catch {
      // swallow listener errors
    }
  }
}

function jitter(baseMs: number): number {
  if (baseMs === 0) return 0;
  const delta = baseMs * 0.2;
  return Math.max(0, baseMs + (Math.random() * 2 - 1) * delta);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Network-level error (no HTTP response) or 5xx — safe and worth retrying.
 * 4xx responses are application-level "no" answers and must not be retried.
 * 429 is the exception: rate limit, honor it but don't pretend it's a 5xx.
 */
function isTransient(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const ax = err as AxiosError;
  // No response at all: DNS fail, TCP reset, timeout, connection refused.
  if (!ax.response) return true;
  const status = ax.response.status;
  return status >= 500 && status < 600;
}

export interface PostWithRetryOptions<T> extends AxiosRequestConfig {
  /** Required. Sent as `Idempotency-Key` header and threaded through retries. */
  idempotencyKey: string;
  /** Default: 3. */
  maxAttempts?: number;
  /** Optional shape hook; not used internally. */
  __t?: T;
}

/**
 * POST with idempotency-aware retry. The server's collect route stores the
 * first successful result under the idempotency key, so replays return the
 * same answer without double-collecting. The auth 401 refresh flow in the
 * response interceptor still runs inside each attempt.
 */
export async function postWithRetry<TResponse, TBody = unknown>(
  url: string,
  body: TBody,
  opts: PostWithRetryOptions<TResponse>,
): Promise<AxiosResponse<TResponse>> {
  const { idempotencyKey, maxAttempts = RETRY_BACKOFF_MS.length, ...rest } = opts;
  const headers = { ...(rest.headers ?? {}), 'Idempotency-Key': idempotencyKey };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(jitter(RETRY_BACKOFF_MS[attempt - 1] ?? 0));
    }
    try {
      return await api.post<TResponse>(url, body, { ...rest, headers });
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxAttempts) {
        throw err;
      }
      emitRetry({ idempotencyKey, attempt, maxAttempts, error: err });
    }
  }
  throw lastErr;
}
