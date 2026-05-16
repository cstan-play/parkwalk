/**
 * `now` defaults to the real current time so callers don't have to know
 * the time of day; callers that already track a bucket can override. The
 * substitution swaps sun-bearing daytime emojis (codes 0–2) for night
 * equivalents between 22:00 and 05:00 so a clear sky at midnight does not
 * render as ☀️.
 */
function isNightAt(now: Date): boolean {
  const h = now.getHours();
  return h < 5 || h >= 22;
}

export function weatherCodeToEmoji(
  code: number | undefined | null,
  opts?: { now?: Date },
): string {
  if (code === undefined || code === null || !Number.isFinite(code)) return '🌤️';
  const night = isNightAt(opts?.now ?? new Date());
  if (code === 0) return night ? '🌙' : '☀️';
  if (code <= 2) return night ? '☁️' : '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 63) return '🌧️';
  if (code === 65) return '⛈️';
  if (code === 66 || code === 67) return '🌧️';
  if (code >= 71 && code <= 73) return '🌨️';
  if (code === 75) return '❄️';
  if (code === 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code === 85 || code === 86) return '🌨️';
  if (code === 95) return '⛈️';
  if (code === 96 || code === 99) return '⛈️';
  return '🌤️';
}

export function formatLocationLabel(location: {
  city: string | null;
  region: string | null;
  country: string | null;
} | null): string | null {
  if (!location) return null;
  const parts = [location.city, location.region, location.country].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (parts.length === 0) return null;
  return parts.join(', ');
}

export function formatTemperatureLabel(temp: number | undefined | null): string | null {
  if (temp === undefined || temp === null || !Number.isFinite(temp)) return null;
  return `${Math.round(temp)}°`;
}
