import Geolocation, { type GeoPosition } from 'react-native-geolocation-service';
import { create } from 'zustand';

import {
  fetchWeather,
  type WeatherLocation,
  type WeatherRaw,
  type WeatherResponse,
} from '@/services/weatherApi';

type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WeatherStoreState {
  status: WeatherStatus;
  description: string | null;
  raw: WeatherRaw | null;
  location: WeatherLocation | null;
  coords: { lat: number; lng: number } | null;
  lastFetchedAt: number | null;
  errorMessage: string | null;
  refresh: () => Promise<void>;
}

const GEOLOC_TIMEOUT_MS = 8_000;

function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(new Error(err.message || 'Location unavailable')),
      {
        enableHighAccuracy: false,
        timeout: GEOLOC_TIMEOUT_MS,
        maximumAge: 60_000,
      },
    );
  });
}

export const useWeatherStore = create<WeatherStoreState>((set) => ({
  status: 'idle',
  description: null,
  raw: null,
  location: null,
  coords: null,
  lastFetchedAt: null,
  errorMessage: null,
  refresh: async () => {
    set({ status: 'loading', errorMessage: null });
    try {
      const pos = await getCurrentPosition();
      const result: WeatherResponse = await fetchWeather(
        pos.coords.latitude,
        pos.coords.longitude,
      );
      set({
        status: 'ready',
        description: result.description,
        raw: result.raw,
        location: result.location,
        coords: result.coords,
        lastFetchedAt: Date.now(),
        errorMessage: null,
      });
    } catch (err) {
      set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Weather unavailable',
      });
    }
  },
}));
