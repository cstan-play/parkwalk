import type { SmellType, WalkSession } from '@parkwalk/shared';
import { useRoute, type RouteProp } from '@react-navigation/native';
import MapboxGL, { type Camera as MapboxCamera } from '@rnmapbox/maps';
import { useQuery } from '@tanstack/react-query';
import type { Position } from 'geojson';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PARKWALK_MAP_STYLE_URL } from '@/config/mapStyle';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { fetchWalk } from '@/services/walksApi';
import { useWalkSessionStore, type LocalWalkSession } from '@/stores/walkSessionStore';
import { colors, fonts } from '@/theme';
import {
  describeWalkSmells,
  type DescribeWalkSmellsOutput,
  type TimeOfDayBucket,
} from '@/utils/smells';

type Route = RouteProp<RootStackParamList, 'WalkDetail'>;
const DETAIL_OVERVIEW_ZOOM = 12;
const DETAIL_ROUTE_ZOOM = 15;
const DETAIL_CAMERA_ANIMATION_MS = 450;

export function WalkDetailScreen(): JSX.Element {
  const route = useRoute<Route>();
  const cameraRef = useRef<MapboxCamera>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const localWalk = useWalkSessionStore((s) =>
    s.completedSessions.find(
      (walk) => walk.clientId === route.params.clientId || walk.serverId === route.params.walkId,
    ),
  );
  const lastKnownLocation = useWalkSessionStore((s) => s.lastKnownLocation);
  const remote = useQuery({
    queryKey: ['walk', route.params.walkId],
    queryFn: () => fetchWalk(route.params.walkId),
    enabled: !localWalk && route.params.walkId !== route.params.clientId,
  });

  const walk = localWalk ?? remote.data ?? null;
  const coordinates = useMemo<Position[][]>(() => {
    if (!walk) return [];
    const pathSegments = Array.isArray(walk.pathSegments) ? walk.pathSegments : [];
    return pathSegments
      .map((segment) =>
        Array.isArray(segment.points)
          ? segment.points
              .filter(isRenderablePoint)
              .map((point) => [point.longitude, point.latitude] as Position)
          : [],
      )
      .filter((segment) => segment.length >= 2);
  }, [walk]);
  const shape = useMemo(
    () =>
      coordinates.length > 0
        ? ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'MultiLineString', coordinates },
          } as const)
        : null,
    [coordinates],
  );
  // Resolution ladder: real route first; then the captured start fix on a
  // local walk; then the latest GPS we've seen anywhere. If none resolve we
  // intentionally render an empty-state instead of showing a placeholder
  // somewhere on the planet.
  const center = useMemo<Position | null>(() => {
    if (coordinates[0]?.[0]) return coordinates[0][0]!;
    if (walk && 'startLocation' in walk && walk.startLocation) {
      return [walk.startLocation.longitude, walk.startLocation.latitude];
    }
    if (lastKnownLocation) {
      return [lastKnownLocation.longitude, lastKnownLocation.latitude];
    }
    return null;
  }, [coordinates, walk, lastKnownLocation]);
  const centerKey = center ? `${center[0]},${center[1]}` : null;

  useEffect(() => {
    if (!mapLoaded || !walk || !center) return;
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel: DETAIL_ROUTE_ZOOM,
      animationDuration: DETAIL_CAMERA_ANIMATION_MS,
      animationMode: 'easeTo',
    });
  }, [center, centerKey, mapLoaded, walk]);

  const smellsSummary = useMemo(
    () => (walk ? buildSmellsSummary(walk) : null),
    [walk],
  );

  if (!walk) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{remote.isError ? 'Could not load walk.' : 'Loading walk...'}</Text>
      </View>
    );
  }

  const endedAt = walk.endedAt ?? walk.startedAt;
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(walk.startedAt)) / 1000));
  const pausedSeconds =
    'pausedDurationSeconds' in walk && typeof walk.pausedDurationSeconds === 'number'
      ? walk.pausedDurationSeconds
      : 0;
  const movingSeconds = Math.max(0, durationSeconds - pausedSeconds);
  const smellCount = getCollectedCount(walk);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Walk with Gus</Text>
        <Text style={styles.title}>Walk report</Text>
        <Text style={styles.subtitle}>{formatWalkDate(walk.startedAt)}</Text>
      </View>
      <View style={styles.heroStats}>
        <View style={styles.heroStat}>
          <Text style={styles.heroValue}>{formatDistance(walk.distanceMeters)}</Text>
          <Text style={styles.heroLabel}>Distance</Text>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroValue}>{smellCount}</Text>
          <Text style={styles.heroLabel}>New smells</Text>
        </View>
      </View>
      <View style={styles.mapBox}>
        {center ? (
          <MapboxGL.MapView
            style={styles.map}
            styleURL={PARKWALK_MAP_STYLE_URL}
            logoEnabled={false}
            attributionEnabled={false}
            onDidFinishLoadingMap={() => setMapLoaded(true)}
          >
            <MapboxGL.Camera
              ref={cameraRef}
              defaultSettings={{ centerCoordinate: center, zoomLevel: DETAIL_OVERVIEW_ZOOM }}
            />
            {shape ? (
              <MapboxGL.ShapeSource id="walk-detail-route" shape={shape}>
                <MapboxGL.LineLayer
                  id="walk-detail-route-line"
                  style={{
                    lineColor: '#BC8F65',
                    lineWidth: 6,
                    lineOpacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </MapboxGL.ShapeSource>
            ) : null}
          </MapboxGL.MapView>
        ) : (
          <View style={styles.mapEmpty}>
            <Text style={styles.mapEmptyText}>Walk too short to map</Text>
          </View>
        )}
      </View>
      <View style={styles.statsGrid}>
        <Stat label="Distance" value={formatDistance(walk.distanceMeters)} />
        <Stat label="Steps" value={`${walk.stepCount}`} />
        <Stat label="Moving" value={formatDuration(movingSeconds)} />
        <Stat label="Paused" value={formatDuration(pausedSeconds)} />
        <Stat label="Total" value={formatDuration(durationSeconds)} />
        <Stat label="Smells" value={`${smellCount}`} />
      </View>
      {smellsSummary ? <SmellsSummary summary={smellsSummary} /> : null}
    </ScrollView>
  );
}

function SmellsSummary({ summary }: { summary: DescribeWalkSmellsOutput }): JSX.Element {
  return (
    <View style={styles.smellsBlock}>
      <Text style={styles.smellsHeadline}>{summary.headline}</Text>
      {summary.lines.map((line, idx) => (
        <Text key={idx} style={styles.smellLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function buildSmellsSummary(
  walk: LocalWalkSession | WalkSession,
): DescribeWalkSmellsOutput | null {
  const byType = readByType(walk);
  if (!byType) return null;
  const total = Object.values(byType).reduce((sum, count) => sum + (count ?? 0), 0);
  const collected = getCollectedCount(walk);
  // Legacy collectibles (seeded before the smellType field was added) come
  // through with no `smellType` in their config, so `byType` ends up empty
  // even when the user collected several. Surface a short "couldn't classify"
  // line instead of the generic empty headline.
  if (total === 0 && collected > 0) {
    return {
      headline: `${collected} find${collected === 1 ? '' : 's'}, no breakdown yet.`,
      lines: ['Older markers — collect a freshly seeded one and the details show up here.'],
    };
  }
  return describeWalkSmells({
    byType,
    weather: readWeather(walk),
    timeOfDay: timeOfDayFromIso(walk.startedAt),
    walkSeed: walk.clientId,
  });
}

function readByType(walk: LocalWalkSession | WalkSession): Partial<Record<SmellType, number>> | null {
  if ('collectedSmells' in walk) {
    const counts: Partial<Record<SmellType, number>> = {};
    for (const smell of walk.collectedSmells) {
      counts[smell.smellType] = (counts[smell.smellType] ?? 0) + 1;
    }
    return counts;
  }
  if ('smells' in walk && walk.smells) {
    return walk.smells.byType;
  }
  return null;
}

function readWeather(walk: LocalWalkSession | WalkSession): string | null {
  if ('weatherSnapshot' in walk && walk.weatherSnapshot) {
    return walk.weatherSnapshot;
  }
  return null;
}

function timeOfDayFromIso(iso: string): TimeOfDayBucket {
  const d = new Date(iso);
  const h = Number.isFinite(d.getHours()) ? d.getHours() : 12;
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'midday';
  if (h < 22) return 'evening';
  return 'night';
}

function getCollectedCount(walk: LocalWalkSession | WalkSession): number {
  if ('collectedEntityIds' in walk) return walk.collectedEntityIds.length;
  return walk.collectedCount;
}

function isRenderablePoint(value: unknown): value is { latitude: number; longitude: number } {
  if (typeof value !== 'object' || value === null) return false;
  const latitude = (value as { latitude?: unknown }).latitude;
  const longitude = (value as { longitude?: unknown }).longitude;
  return typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function formatWalkDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recent walk';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 34 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  emptyText: { color: '#5A1C01', textAlign: 'center', fontSize: 16, fontWeight: '700' },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  kicker: {
    color: '#5A1C01',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: {
    marginTop: 8,
    color: '#000',
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 45,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    color: '#3C3C3C',
    fontSize: 15,
    fontWeight: '600',
  },
  heroStats: {
    minHeight: 104,
    borderRadius: 28,
    backgroundColor: '#F7EFE5',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    marginBottom: 16,
    shadowColor: '#6A3E1B',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
  },
  heroDivider: {
    width: 1,
    height: 58,
    backgroundColor: '#D9C2AA',
    marginHorizontal: 12,
  },
  heroValue: {
    color: '#5A1C01',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  heroLabel: {
    marginTop: 4,
    color: '#4A3628',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  mapBox: {
    height: 310,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#E9DCCA',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  map: { flex: 1 },
  mapEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  mapEmptyText: { color: '#5A1C01', fontSize: 15, fontWeight: '800' },
  statsGrid: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  stat: {
    // 3-column grid under the map. With `gap: 12` on the parent and
    // 18px ScrollView side padding, three 31%-wide cells fit cleanly on
    // a standard phone (≥ 358pt content width). On very narrow devices
    // they wrap to 2-per-row gracefully thanks to `flexWrap`.
    width: '31%',
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: '#F7EFE5',
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  statValue: { fontSize: 20, fontWeight: '900', color: '#5A1C01' },
  statLabel: {
    marginTop: 4,
    color: '#4A3628',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  smellsBlock: {
    marginTop: 16,
    padding: 18,
    backgroundColor: '#F7EFE5',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  smellsHeadline: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    color: '#5A1C01',
    marginBottom: 10,
  },
  smellLine: {
    fontSize: 15,
    color: '#2F241D',
    lineHeight: 22,
    marginTop: 6,
  },
});
