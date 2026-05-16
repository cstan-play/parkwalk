export function weatherCodeToEmoji(code: number | undefined | null): string {
  if (code === undefined || code === null || !Number.isFinite(code)) return '🌤️';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
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
