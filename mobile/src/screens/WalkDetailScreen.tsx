import type { WalkSession } from '@parkwalk/shared';
import { useRoute, type RouteProp } from '@react-navigation/native';
import MapboxGL, { type Camera as MapboxCamera } from '@rnmapbox/maps';
import { useQuery } from '@tanstack/react-query';
import type { Position } from 'geojson';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { fetchWalk } from '@/services/walksApi';
import { useWalkSessionStore, type LocalWalkSession } from '@/stores/walkSessionStore';

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
  const center = useMemo<Position>(
    () => coordinates[0]?.[0] ?? ([-122.4194, 37.7749] as Position),
    [coordinates],
  );
  const centerKey = `${center[0]},${center[1]}`;

  useEffect(() => {
    if (!mapLoaded || !walk) return;
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
        <MapboxGL.MapView
          style={styles.map}
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
      </View>
      <View style={styles.statsGrid}>
        <Stat label="Distance" value={formatDistance(walk.distanceMeters)} />
        <Stat label="Steps" value={`${walk.stepCount}`} />
        <Stat label="Moving" value={formatDuration(movingSeconds)} />
        <Stat label="Paused" value={formatDuration(pausedSeconds)} />
        <Stat label="Total" value={formatDuration(durationSeconds)} />
        <Stat label="Collected" value={`${getCollectedCount(walk)}`} />
      </View>
    </ScrollView>
  );
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
});
