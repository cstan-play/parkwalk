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
    return walk.pathSegments
      .map((segment) => segment.points.map((point) => [point.longitude, point.latitude] as Position))
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

  if (!walk) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{remote.isError ? 'Could not load walk.' : 'Loading walk...'}</Text>
      </View>
    );
  }

  const smellsSummary = useMemo(
    () => buildSmellsSummary(walk),
    [walk],
  );

  const endedAt = walk.endedAt ?? walk.startedAt;
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(walk.startedAt)) / 1000));
  const pausedSeconds =
    'pausedDurationSeconds' in walk && typeof walk.pausedDurationSeconds === 'number'
      ? walk.pausedDurationSeconds
      : 0;
  const movingSeconds = Math.max(0, durationSeconds - pausedSeconds);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
                    lineColor: '#0EA5E9',
                    lineWidth: 5,
                    lineOpacity: 0.85,
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
        <Stat label="New smells found" value={`${getCollectedCount(walk)}`} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#6B7280', textAlign: 'center', fontSize: 16 },
  mapBox: {
    height: 320,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  map: { flex: 1 },
  mapEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  mapEmptyText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  statsGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stat: {
    width: '48%',
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: 'white',
    padding: 12,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  statValue: { fontSize: 20, fontWeight: '800', color: '#111827' },
  statLabel: { marginTop: 3, color: '#6B7280', fontSize: 12, textTransform: 'uppercase' },
  smellsBlock: {
    marginTop: 14,
    padding: 14,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  smellsHeadline: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  smellLine: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginTop: 4,
  },
});
