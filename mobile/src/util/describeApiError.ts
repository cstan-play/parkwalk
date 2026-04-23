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
      return `Timed out talking to ${full}. Confirm the backend is up and Wi‑Fi matches your Mac.`;
    }
    if (!err.response) {
      return `${err.message ?? 'Network error'} — ${full}. On a real iPhone, 127.0.0.1/localhost points at the phone, not your Mac. Use your Mac LAN IP (from ipconfig) in API / Server, or update mobile/.env and rebuild.`;
    }
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
