import { api } from './apiClient';

export interface WeatherLocation {
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface WeatherRaw {
  temperature_2m?: number;
  weather_code?: number;
  precipitation?: number;
  wind_speed_10m?: number;
}

export interface WeatherResponse {
  description: string | null;
  raw: WeatherRaw | null;
  location: WeatherLocation | null;
  coords: { lat: number; lng: number };
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherResponse> {
  const { data } = await api.get<WeatherResponse>('/api/v1/weather', {
    params: { lat, lng },
  });
  return data;
}
