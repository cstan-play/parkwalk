import axios from 'axios';

/**
 * Human-readable API errors for alerts. Prefer server `error.message` when present.
 */
export function describeApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string } } | undefined;
    const serverMsg = data?.error?.message;
    if (serverMsg) return serverMsg;

    const base = err.config?.baseURL ?? '(missing base URL)';
    const path = err.config?.url ?? '';
    const full = `${base}${path}`;

    if (err.code === 'ECONNABORTED') {
      return `Timed out talking to ${full}. Confirm the hosted API is reachable and try again.`;
    }
    if (!err.response) {
      return `${err.message ?? 'Network error'} — ${full}. Confirm the API URL is HTTPS and reachable from this device.`;
    }
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
