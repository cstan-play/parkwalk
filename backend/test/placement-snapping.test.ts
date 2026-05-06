import type { WalkablePlacementConfig } from '../src/modules/entities/placement.config.js';
import {
  createMemoryWalkableSnapCache,
  filterWalkableTilequeryFeature,
  findWalkableSnapCandidates,
  selectSnappedCandidates,
  tilequeryCacheKey,
  type SnappedPlacementCandidate,
} from '../src/modules/entities/walkable-snapping.js';

const config: WalkablePlacementConfig = {
  MAPBOX_ACCESS_TOKEN: 'pk.test',
  WALKABLE_SNAPPING_ENABLED: true,
  WALKABLE_SNAP_MAX_METERS: 35,
  WALKABLE_SNAP_CACHE_TTL_SECONDS: 86400,
  WALKABLE_SNAP_REQUIRED: false,
  WALKABLE_TILEQUERY_MAX_CALLS: 3,
};

describe('walkable snapping', () => {
  it('accepts only Mapbox road features that are walkable linestrings', () => {
    const probe = { lat: 55.6761, lng: 12.5683 };
    const accepted = filterWalkableTilequeryFeature(
      {
        id: 123,
        geometry: { type: 'Point', coordinates: [12.5684, 55.6762] },
        properties: {
          class: 'path',
          type: 'footway',
          name: 'Campus Walk',
          tilequery: { layer: 'road', geometry: 'linestring', distance: 6.5 },
        },
      },
      probe,
    );

    expect(accepted).toMatchObject({
      lat: 55.6762,
      lng: 12.5684,
      originalCandidate: probe,
      snap: {
        status: 'snapped',
        provider: 'mapbox_tilequery',
        distanceMeters: 6.5,
        featureId: '123',
        class: 'path',
        type: 'footway',
        name: 'Campus Walk',
      },
    });

    expect(
      filterWalkableTilequeryFeature(
        {
          geometry: { type: 'Point', coordinates: [12.5684, 55.6762] },
          properties: {
            class: 'path',
            type: 'cycleway',
            tilequery: { layer: 'road', geometry: 'linestring', distance: 4 },
          },
        },
        probe,
      ),
    ).toBeNull();
    expect(
      filterWalkableTilequeryFeature(
        {
          geometry: { type: 'Point', coordinates: [12.5684, 55.6762] },
          properties: {
            class: 'street',
            type: 'residential',
            tilequery: { layer: 'road', geometry: 'linestring', distance: 4 },
          },
        },
        probe,
      ),
    ).toBeNull();
  });

  it('limits Tilequery calls to the configured probe budget', async () => {
    const fetchFn = jest.fn(async () => jsonResponse({ features: [] }));

    await findWalkableSnapCandidates({
      center: { lat: 55.6761, lng: 12.5683 },
      radiusMeters: 140,
      minDistanceMeters: 25,
      minSpacingMeters: 18,
      occupied: [],
      wanted: 12,
      config,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(config.WALKABLE_TILEQUERY_MAX_CALLS);
  });

  it('uses quantized cache keys for repeated probes', async () => {
    const cache = createMemoryWalkableSnapCache();
    const fetchFn = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const [lng, lat] = url.pathname.split('/').at(-1)!.replace('.json', '').split(',');
      return jsonResponse({
        features: [
          {
            id: 'cached-path',
            geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
            properties: {
              class: 'pedestrian',
              type: 'pedestrian',
              tilequery: { layer: 'road', geometry: 'linestring', distance: 0 },
            },
          },
        ],
      });
    });
    const rngValues = [0.25, 0.25];
    const makeRng = (): (() => number) => {
      let index = 0;
      return () => rngValues[index++ % rngValues.length]!;
    };
    const oneProbeConfig = { ...config, WALKABLE_TILEQUERY_MAX_CALLS: 1 };

    await findWalkableSnapCandidates({
      center: { lat: 55.6761, lng: 12.5683 },
      radiusMeters: 80,
      minDistanceMeters: 0,
      minSpacingMeters: 10,
      occupied: [],
      wanted: 1,
      config: oneProbeConfig,
      cache,
      fetchFn,
      rng: makeRng(),
    });
    await findWalkableSnapCandidates({
      center: { lat: 55.6761, lng: 12.5683 },
      radiusMeters: 80,
      minDistanceMeters: 0,
      minSpacingMeters: 10,
      occupied: [],
      wanted: 1,
      config: oneProbeConfig,
      cache,
      fetchFn,
      rng: makeRng(),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(tilequeryCacheKey({ lat: 55.67614, lng: 12.56834 }, 35)).toBe(
      tilequeryCacheKey({ lat: 55.67613, lng: 12.56833 }, 35),
    );
  });

  it('validates radius and spacing after snapped coordinates are returned', () => {
    const center = { lat: 0, lng: 0 };
    const candidates: SnappedPlacementCandidate[] = [
      snapped(0, 0.00001),
      snapped(0, 0.0002),
      snapped(0, 0.0002),
      snapped(0, 0.01),
      snapped(0.0003, 0),
    ];

    const selected = selectSnappedCandidates({
      candidates,
      center,
      radiusMeters: 100,
      minDistanceMeters: 10,
      minSpacingMeters: 20,
      occupied: [],
      wanted: 3,
    });

    expect(selected.map((p) => [Number(p.lat.toFixed(4)), Number(p.lng.toFixed(4))])).toEqual([
      [0, 0.0002],
      [0.0003, 0],
    ]);
  });
});

function snapped(lat: number, lng: number): SnappedPlacementCandidate {
  return {
    lat,
    lng,
    originalCandidate: { lat, lng },
    snap: {
      status: 'snapped',
      provider: 'mapbox_tilequery',
      distanceMeters: 0,
      class: 'path',
      type: 'footway',
    },
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
