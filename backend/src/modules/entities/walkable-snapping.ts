import type Redis from 'ioredis';

import type { WalkablePlacementConfig } from './placement.config.js';
import {
  type GeoPoint,
  isPlacementValid,
  randomDiscPoint,
} from './placement.geo.js';

const MAPBOX_TILEQUERY_URL =
  'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery';
const TILEQUERY_LIMIT = 50;
const WALKABLE_PATH_TYPES = new Set([
  'footway',
  'sidewalk',
  'crossing',
  'steps',
  'path',
  'hiking',
  'trail',
]);

export interface WalkableSnapMetadata {
  status: 'snapped' | 'fallback_unsnapped' | 'not_attempted';
  provider: 'mapbox_tilequery';
  distanceMeters?: number;
  featureId?: string;
  class?: string;
  type?: string;
  name?: string;
}

export interface SnappedPlacementCandidate extends GeoPoint {
  originalCandidate: GeoPoint;
  snap: WalkableSnapMetadata;
}

export interface WalkableSnapCache {
  get(key: string): Promise<SnappedPlacementCandidate[] | null>;
  set(key: string, value: SnappedPlacementCandidate[], ttlSeconds: number): Promise<void>;
}

interface TilequeryFeature {
  id?: string | number;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown> & {
    class?: unknown;
    type?: unknown;
    name?: unknown;
    tilequery?: {
      distance?: unknown;
      geometry?: unknown;
      layer?: unknown;
    };
  };
}

interface TilequeryResponse {
  features?: TilequeryFeature[];
}

export function createMemoryWalkableSnapCache(): WalkableSnapCache {
  const entries = new Map<string, { expiresAt: number; value: SnappedPlacementCandidate[] }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0) return;
      entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
    },
  };
}

export function createRedisWalkableSnapCache(redis: Redis): WalkableSnapCache {
  const memory = createMemoryWalkableSnapCache();
  return {
    async get(key) {
      try {
        const cached = await redis.get(key);
        if (!cached) return null;
        const parsed = JSON.parse(cached) as SnappedPlacementCandidate[];
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return memory.get(key);
      }
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0) return;
      const serialized = JSON.stringify(value);
      await memory.set(key, value, ttlSeconds);
      try {
        await redis.setex(key, ttlSeconds, serialized);
      } catch {
        // Redis is an optimization here; placement must keep working without it.
      }
    },
  };
}

export async function findWalkableSnapCandidates(params: {
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters: number;
  minSpacingMeters: number;
  occupied: GeoPoint[];
  wanted: number;
  config: WalkablePlacementConfig;
  cache?: WalkableSnapCache;
  fetchFn?: typeof fetch;
  rng?: () => number;
}): Promise<SnappedPlacementCandidate[]> {
  if (
    !params.config.WALKABLE_SNAPPING_ENABLED ||
    !params.config.MAPBOX_ACCESS_TOKEN ||
    params.config.WALKABLE_TILEQUERY_MAX_CALLS <= 0 ||
    params.wanted <= 0
  ) {
    return [];
  }

  const probes = createProbePoints({
    center: params.center,
    radiusMeters: params.radiusMeters,
    minDistanceMeters: params.minDistanceMeters,
    count: params.config.WALKABLE_TILEQUERY_MAX_CALLS,
    rng: params.rng,
  });
  const candidates: SnappedPlacementCandidate[] = [];

  for (const probe of probes) {
    const key = tilequeryCacheKey(probe, params.config.WALKABLE_SNAP_MAX_METERS);
    const cached = params.cache ? await params.cache.get(key) : null;
    const snapped =
      cached ??
      (await fetchTilequeryCandidates({
        probe,
        config: params.config,
        fetchFn: params.fetchFn ?? fetch,
      }));
    if (!cached && params.cache) {
      await params.cache.set(key, snapped, params.config.WALKABLE_SNAP_CACHE_TTL_SECONDS);
    }
    candidates.push(...snapped);
  }

  return selectSnappedCandidates({
    candidates,
    center: params.center,
    radiusMeters: params.radiusMeters,
    minDistanceMeters: params.minDistanceMeters,
    minSpacingMeters: params.minSpacingMeters,
    occupied: params.occupied,
    wanted: params.wanted,
  });
}

export function selectSnappedCandidates(params: {
  candidates: SnappedPlacementCandidate[];
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters: number;
  minSpacingMeters: number;
  occupied: GeoPoint[];
  wanted: number;
}): SnappedPlacementCandidate[] {
  const selected: SnappedPlacementCandidate[] = [];
  const occupied = [...params.occupied];
  const seen = new Set<string>();

  for (const candidate of params.candidates) {
    const key = `${candidate.lat.toFixed(6)}:${candidate.lng.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      !isPlacementValid({
        point: candidate,
        center: params.center,
        radiusMeters: params.radiusMeters,
        minDistanceMeters: params.minDistanceMeters,
        minSpacingMeters: params.minSpacingMeters,
        occupied,
      })
    ) {
      continue;
    }
    selected.push(candidate);
    occupied.push(candidate);
    if (selected.length >= params.wanted) break;
  }

  return selected;
}

export function filterWalkableTilequeryFeature(
  feature: TilequeryFeature,
  probe: GeoPoint,
): SnappedPlacementCandidate | null {
  const properties = feature.properties;
  const tilequery = properties?.tilequery;
  const coordinates = feature.geometry?.coordinates;
  if (!properties || !tilequery || !Array.isArray(coordinates)) return null;
  if (feature.geometry?.type !== 'Point') return null;
  if (tilequery.layer !== 'road' || tilequery.geometry !== 'linestring') return null;
  if (coordinates.length < 2 || typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') {
    return null;
  }

  const roadClass = asString(properties.class);
  const roadType = asString(properties.type);
  const isPedestrian = roadClass === 'pedestrian';
  const isWalkablePath = roadClass === 'path' && roadType !== undefined && WALKABLE_PATH_TYPES.has(roadType);
  if (!isPedestrian && !isWalkablePath) return null;

  const distanceMeters = typeof tilequery.distance === 'number' ? tilequery.distance : undefined;
  return {
    lat: coordinates[1],
    lng: coordinates[0],
    originalCandidate: probe,
    snap: {
      status: 'snapped',
      provider: 'mapbox_tilequery',
      distanceMeters,
      featureId: feature.id === undefined ? undefined : String(feature.id),
      class: roadClass,
      type: roadType,
      name: asString(properties.name),
    },
  };
}

export function tilequeryCacheKey(point: GeoPoint, radiusMeters: number): string {
  return `walkable:v1:mapbox:${point.lat.toFixed(4)}:${point.lng.toFixed(4)}:r${radiusMeters}`;
}

async function fetchTilequeryCandidates(params: {
  probe: GeoPoint;
  config: WalkablePlacementConfig;
  fetchFn: typeof fetch;
}): Promise<SnappedPlacementCandidate[]> {
  const url = buildTilequeryUrl(params.probe, params.config);
  try {
    const response = await params.fetchFn(url);
    if (!response.ok) return [];
    const body = (await response.json()) as TilequeryResponse;
    return (body.features ?? [])
      .map((feature) => filterWalkableTilequeryFeature(feature, params.probe))
      .filter((candidate): candidate is SnappedPlacementCandidate => candidate !== null);
  } catch {
    return [];
  }
}

function buildTilequeryUrl(point: GeoPoint, config: WalkablePlacementConfig): string {
  const url = new URL(`${MAPBOX_TILEQUERY_URL}/${point.lng},${point.lat}.json`);
  url.searchParams.set('access_token', config.MAPBOX_ACCESS_TOKEN ?? '');
  url.searchParams.set('radius', String(config.WALKABLE_SNAP_MAX_METERS));
  url.searchParams.set('limit', String(TILEQUERY_LIMIT));
  url.searchParams.set('layers', 'road');
  url.searchParams.set('geometry', 'linestring');
  url.searchParams.set('dedupe', 'true');
  return url.toString();
}

function createProbePoints(params: {
  center: GeoPoint;
  radiusMeters: number;
  minDistanceMeters: number;
  count: number;
  rng?: () => number;
}): GeoPoint[] {
  const probes: GeoPoint[] = [];
  for (let i = 0; i < params.count; i++) {
    probes.push(
      randomDiscPoint({
        center: params.center,
        radiusMeters: params.radiusMeters,
        minDistanceMeters: params.minDistanceMeters,
        rng: params.rng,
      }),
    );
  }
  return probes;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
