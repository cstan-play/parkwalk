import { env } from '../env.js';
import { logger } from '../logger.js';
import { redis } from '../redis.js';

const CACHE_TTL_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 4_000;
const CACHE_KEY_PREFIX = 'gus:weather';
const NULL_SENTINEL = '__null__';

export interface OpenMeteoCurrent {
  temperature_2m?: number;
  weather_code?: number;
  precipitation?: number;
  wind_speed_10m?: number;
}

export interface WeatherSnapshot {
  raw: OpenMeteoCurrent | null;
  description: string | null;
}

/**
 * Renders a short Gus-readable weather description ("light rain, 8°C") for a
 * lat/lng. Hits Open-Meteo (no API key) with a 1-hour Redis cache keyed by
 * rounded coords + UTC hour. Never throws — returns null on any failure so
 * callers can fall through to the legacy `weather: null` path unchanged.
 */
export async function getWeatherDescription(lat: number, lng: number): Promise<string | null> {
  if (env.WEATHER_PROVIDER === 'none') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cacheKey = makeCacheKey(lat, lng);

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === NULL_SENTINEL ? null : cached;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'weather cache read failed');
  }

  let description: string | null = null;
  try {
    description = await fetchOpenMeteo(lat, lng);
  } catch (err) {
    logger.warn({ err: (err as Error).message, lat, lng }, 'weather fetch failed');
  }

  try {
    await redis.set(cacheKey, description ?? NULL_SENTINEL, 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'weather cache write failed');
  }

  return description;
}

function makeCacheKey(lat: number, lng: number): string {
  const hour = new Date().getUTCHours();
  return `${CACHE_KEY_PREFIX}:${lat.toFixed(2)}:${lng.toFixed(2)}:${hour}`;
}

/**
 * Live, uncached snapshot used by the OpenMeteo debug command. Returns the
 * raw `current` object alongside the same formatted description the
 * cached production path would produce.
 */
export async function getWeatherSnapshot(lat: number, lng: number): Promise<WeatherSnapshot> {
  if (env.WEATHER_PROVIDER === 'none') return { raw: null, description: null };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { raw: null, description: null };
  try {
    const raw = await fetchOpenMeteoCurrent(lat, lng);
    return { raw, description: raw ? formatDescription(raw) : null };
  } catch (err) {
    logger.warn({ err: (err as Error).message, lat, lng }, 'weather snapshot failed');
    return { raw: null, description: null };
  }
}

async function fetchOpenMeteo(lat: number, lng: number): Promise<string | null> {
  const current = await fetchOpenMeteoCurrent(lat, lng);
  return current ? formatDescription(current) : null;
}

async function fetchOpenMeteoCurrent(lat: number, lng: number): Promise<OpenMeteoCurrent | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat.toString())}` +
    `&longitude=${encodeURIComponent(lng.toString())}` +
    `&current=temperature_2m,weather_code,precipitation,wind_speed_10m`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { current?: OpenMeteoCurrent };
    return data.current ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

function formatDescription(current: OpenMeteoCurrent): string | null {
  // Start with the WMO phrase; if precipitation > 0 but the code reads as
  // dry (clear/partly cloudy/overcast), override — Open-Meteo's hourly code
  // can lag actual conditions especially for light rain.
  let condition = describeWeatherCode(current.weather_code);
  if (
    (current.precipitation ?? 0) > 0 &&
    (condition === 'clear' || condition === 'partly cloudy' || condition === 'overcast')
  ) {
    condition = 'light rain';
  }
  if (!condition) return null;

  const parts: string[] = [condition];
  if (typeof current.temperature_2m === 'number') {
    parts.push(`${Math.round(current.temperature_2m)}°C`);
  }
  const windDescriptor = describeWind(current.wind_speed_10m);
  if (windDescriptor) parts.push(windDescriptor);
  return parts.join(', ');
}

/**
 * Wind speed (m/s) → short adjective. Calm conditions yield no descriptor
 * so the weather string stays terse on typical days.
 */
function describeWind(speedMps: number | undefined): string | null {
  if (typeof speedMps !== 'number') return null;
  if (speedMps < 3) return null;
  if (speedMps < 7) return 'breezy';
  if (speedMps < 12) return 'windy';
  return 'gusty';
}

/**
 * WMO weather code → short English phrase. See
 * https://open-meteo.com/en/docs#weathervariables for the table.
 */
function describeWeatherCode(code: number | undefined): string | null {
  if (code === undefined || !Number.isFinite(code)) return null;
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 63) return 'light rain';
  if (code === 65) return 'heavy rain';
  if (code === 66 || code === 67) return 'freezing rain';
  if (code >= 71 && code <= 73) return 'light snow';
  if (code === 75) return 'heavy snow';
  if (code === 77) return 'snow grains';
  if (code >= 80 && code <= 81) return 'rain showers';
  if (code === 82) return 'violent rain showers';
  if (code === 85 || code === 86) return 'snow showers';
  if (code === 95) return 'thunderstorm';
  if (code === 96 || code === 99) return 'thunderstorm with hail';
  return null;
}
