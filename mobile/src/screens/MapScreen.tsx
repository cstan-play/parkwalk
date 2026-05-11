import type { GameEntity } from '@parkwalk/shared';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapboxGL, { type Camera as MapboxCamera, type MapState } from '@rnmapbox/maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Position } from 'geojson';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Config from 'react-native-config';

import { CompanionLayer } from '@/components/CompanionLayer';
import { PARKWALK_MAP_STYLE_URL } from '@/config/mapStyle';
import { useCompanion } from '@/hooks/useCompanion';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { useMovementDetection } from '@/hooks/useMovementDetection';
import { useWalkSession } from '@/hooks/useWalkSession';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { schedulePostWalkDebrief } from '@/notifications/scheduler';
import { onRetry } from '@/services/apiClient';
import { collectEntity, fetchNearby } from '@/services/entitiesApi';
import {
  getMovingDurationSeconds,
  getPausedDurationSeconds,
  useWalkSessionStore,
  type LocalWalkSession,
} from '@/stores/walkSessionStore';
import { haversineMeters } from '@/util/geo';

// Mirrors `MAX_ACCURACY_TOLERANCE_M` on the backend. Cap applied to the user's
// reported horizontal accuracy before subtracting it from the measured
// distance to an entity; prevents inflated-uncertainty "teleport" collects.
const MAX_ACCURACY_TOLERANCE_M = 35;
const DEFAULT_CENTER_COORDINATE: Position = [-122.4194, 37.7749];
const INITIAL_MAP_ZOOM = 16;
const RECENTER_ANIMATION_MS = 550;
const SHOW_FIELD_DIAGNOSTICS = __DEV__ || Config.FIELD_DEBUG_OVERLAY === 'true';

type VisibleBounds = { ne: Position; sw: Position };
type Nav = NativeStackNavigationProp<RootStackParamList, 'Map'>;

type CollectUiState =
  | { kind: 'idle' }
  | { kind: 'sending'; entityId: string; idempotencyKey: string }
  | {
      kind: 'retrying';
      entityId: string;
      idempotencyKey: string;
      attempt: number;
      maxAttempts: number;
    };

export function MapScreen(): JSX.Element {
  const movement = useMovementDetection();
  useWalkSession(movement);
  const navigation = useNavigation<Nav>();
  const cameraRef = useRef<MapboxCamera>(null);
  const isFollowingUserRef = useRef(true);
  const cameraStateRef = useRef({
    zoom: INITIAL_MAP_ZOOM,
    heading: 0,
    pitch: 70,
  });
  const visibleBoundsRef = useRef<VisibleBounds | null>(null);
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [collectUi, setCollectUi] = useState<CollectUiState>({ kind: 'idle' });
  const [isFollowingUser, setIsFollowingUser] = useState(true);
  const [showRecenterButton, setShowRecenterButton] = useState(false);
  const [fieldDiagnosticsExpanded, setFieldDiagnosticsExpanded] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const idem = useIdempotencyKey();
  const queryClient = useQueryClient();
  const activeWalk = useWalkSessionStore((s) => s.activeSession);
  const recoveryPromptPending = useWalkSessionStore((s) => s.recoveryPromptPending);
  const startWalk = useWalkSessionStore((s) => s.startWalk);
  const pauseWalk = useWalkSessionStore((s) => s.pauseWalk);
  const resumeWalk = useWalkSessionStore((s) => s.resumeWalk);
  const endWalk = useWalkSessionStore((s) => s.endWalk);
  const discardActiveWalk = useWalkSessionStore((s) => s.discardActiveWalk);
  const markCollected = useWalkSessionStore((s) => s.markCollected);

  // Companion is only present while a walk is active; it depends on the
  // walk-state gate rather than just the map being open.
  const companion = useCompanion({
    enabled: activeWalk?.status === 'active',
    movement,
    getCameraBearing: () => cameraStateRef.current.heading,
  });

  // Scoped by idempotency key so concurrent collects
  // (unlikely given the marker-tap disable, but defensive) don't cross-talk.
  useEffect(() => {
    return onRetry((e) => {
      setCollectUi((prev) => {
        if (prev.kind === 'idle') return prev;
        if (prev.idempotencyKey !== e.idempotencyKey) return prev;
        return {
          kind: 'retrying',
          entityId: prev.entityId,
          idempotencyKey: prev.idempotencyKey,
          attempt: e.attempt + 1,
          maxAttempts: e.maxAttempts,
        };
      });
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (recoveryPromptPending) setFieldDiagnosticsExpanded(false);
  }, [recoveryPromptPending]);

  const centerCoords = useMemo(() => {
    if (movement.latest) {
      return [movement.latest.location.longitude, movement.latest.location.latitude];
    }
    if (lastLocation) return [lastLocation.lng, lastLocation.lat];
    return DEFAULT_CENTER_COORDINATE;
  }, [movement.latest, lastLocation]);

  const latestUserCoordinate = useMemo<Position | null>(() => {
    if (!movement.latest) return null;
    return [movement.latest.location.longitude, movement.latest.location.latitude];
  }, [movement.latest]);

  const setFollowingUser = useCallback((next: boolean) => {
    isFollowingUserRef.current = next;
    setIsFollowingUser(next);
  }, []);

  const updateRecenterVisibility = useCallback(
    (bounds: VisibleBounds, following = isFollowingUserRef.current) => {
      if (!latestUserCoordinate) {
        setShowRecenterButton(false);
        return;
      }
      const userIsVisible = isCoordinateInBounds(latestUserCoordinate, bounds);
      setShowRecenterButton(!following && !userIsVisible);
    },
    [latestUserCoordinate],
  );

  useEffect(() => {
    const bounds = visibleBoundsRef.current;
    if (bounds) updateRecenterVisibility(bounds);
  }, [latestUserCoordinate, updateRecenterVisibility]);

  const handleCameraChanged = useCallback(
    (state: MapState) => {
      cameraStateRef.current = {
        zoom: state.properties.zoom,
        heading: state.properties.heading,
        pitch: state.properties.pitch,
      };
      const bounds = toVisibleBounds(state.properties.bounds);
      if (bounds) visibleBoundsRef.current = bounds;
      const following = state.gestures?.isGestureActive ? false : isFollowingUserRef.current;
      if (state.gestures?.isGestureActive) setFollowingUser(false);
      if (bounds) updateRecenterVisibility(bounds, following);
    },
    [setFollowingUser, updateRecenterVisibility],
  );

  const recenterOnUser = useCallback(() => {
    if (!latestUserCoordinate) return;
    const camera = cameraStateRef.current;
    setFollowingUser(false);
    cameraRef.current?.setCamera({
      centerCoordinate: latestUserCoordinate,
      zoomLevel: camera.zoom,
      heading: camera.heading,
      pitch: camera.pitch,
      animationDuration: RECENTER_ANIMATION_MS,
      animationMode: 'easeTo',
    });
    setShowRecenterButton(false);
  }, [latestUserCoordinate, setFollowingUser]);

  const nearbyEnabled = !!movement.latest || !!lastLocation;

  const nearbyQuery = useQuery({
    queryKey: ['nearby', roundKey(centerCoords[1]!, centerCoords[0]!)],
    queryFn: () =>
      fetchNearby({
        lat: centerCoords[1]!,
        lng: centerCoords[0]!,
        radiusMeters: 500,
        limit: 50,
      }),
    enabled: nearbyEnabled,
    refetchInterval: 30_000,
  });

  const collectMutation = useMutation({
    mutationFn: async (entity: GameEntity) => {
      if (!activeWalk || activeWalk.status !== 'active') {
        throw new Error(activeWalk?.status === 'paused' ? 'Resume your walk to collect.' : 'Start a walk to collect.');
      }
      if (!movement.summary || !movement.latest) {
        throw new Error('No movement summary yet; stand still for a second and try again');
      }
      const key = idem.next();
      setCollectUi({ kind: 'sending', entityId: entity.id, idempotencyKey: key });
      return await collectEntity(key, {
        entityId: entity.id,
        walkSessionId: activeWalk.clientId,
        location: movement.latest.location,
        summary: movement.summary,
        samples: movement.samples,
        clientSentAt: new Date().toISOString(),
      });
    },
    onSuccess: (_data, entity) => {
      setCollectUi({ kind: 'idle' });
      void markCollected(entity.id);
      Alert.alert(
        'Collected!',
        `+${Number((entity.config as { points?: number }).points ?? 0)} points`,
      );
      void queryClient.invalidateQueries({ queryKey: ['nearby'] });
      void queryClient.invalidateQueries({ queryKey: ['myStats'] });
    },
    onError: (err: unknown) => {
      setCollectUi({ kind: 'idle' });
      const category = categorizeError(err);
      Alert.alert(category.title, category.message);
    },
  });

  // Live GPS fix fed into distance math below. We intentionally do NOT use
  // `entity.distanceMeters` from the nearby query — that value is cached
  // from the last `/nearby` fetch (refetch every 30 s; cache key rotates
  // only on ~111 m displacement), so during a walk it can drift by tens of
  // meters from reality. `movement.latest.location` is the same fix we'll
  // send to the server, so computing distance against it keeps client and
  // server in agreement.
  const livePoint = movement.latest?.location ?? null;
  const liveAccuracyM = typeof livePoint?.accuracy === 'number' ? livePoint.accuracy : 0;

  const liveDistanceTo = (entity: GameEntity): number | null => {
    if (!livePoint) return null;
    return haversineMeters(livePoint, entity.location);
  };

  // Uncertainty-aware proximity gate (mirrors backend).
  //
  // `horizontalAccuracy` is the radius of the disc in which the true
  // position lies. If the closest point of that disc falls inside the
  // collection radius, the tap is plausible. Backend re-validates with
  // PostGIS and applies the same math; disagreement means "server saw an
  // even more drifted fix than we did" — now rare because we send the
  // same fix we used for this gate.
  const collectable = (entity: GameEntity): boolean => {
    const d = liveDistanceTo(entity);
    if (d === null) return false;
    const tolerance = Math.min(liveAccuracyM, MAX_ACCURACY_TOLERANCE_M);
    return d - tolerance <= entity.collectionRadiusMeters;
  };

  const nearest = useMemo(() => {
    if (!livePoint) return null;
    let best: { entity: GameEntity; distance: number } | null = null;
    for (const entity of nearbyQuery.data ?? []) {
      const distance = haversineMeters(livePoint, entity.location);
      if (!best || distance < best.distance) best = { entity, distance };
    }
    return best;
  }, [livePoint, nearbyQuery.data]);

  const isCollectInFlight = collectUi.kind !== 'idle';
  const nowIso = useMemo(() => new Date(nowTick).toISOString(), [nowTick]);
  const movingSeconds = activeWalk ? getMovingDurationSeconds(activeWalk, nowIso) : 0;
  const pausedSeconds = activeWalk ? getPausedDurationSeconds(activeWalk.pauseIntervals, nowIso) : 0;
  const routeCoordinates = useMemo<Position[][]>(() => {
    if (!activeWalk) return [];
    return activeWalk.pathSegments
      .map((segment) => segment.points.map((point) => [point.longitude, point.latitude] as Position))
      .filter((segment) => segment.length >= 2);
  }, [activeWalk]);
  const routeShape = useMemo(
    () =>
      routeCoordinates.length > 0
        ? ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'MultiLineString', coordinates: routeCoordinates },
          } as const)
        : null,
    [routeCoordinates],
  );
  const openCompletedWalk = useCallback(
    (walk: LocalWalkSession | null) => {
      if (!walk) return;
      navigation.navigate('WalkDetail', {
        walkId: walk.serverId ?? walk.clientId,
        clientId: walk.clientId,
      });
    },
    [navigation],
  );
  const endAndOpenWalk = useCallback(async () => {
    const completed = await endWalk();
    if (completed) void schedulePostWalkDebrief();
    openCompletedWalk(completed);
  }, [endWalk, openCompletedWalk]);

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL={PARKWALK_MAP_STYLE_URL}
        onDidFinishLoadingMap={() => undefined}
        onCameraChanged={handleCameraChanged}
        logoEnabled={false}
        attributionEnabled={true}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: DEFAULT_CENTER_COORDINATE,
            zoomLevel: INITIAL_MAP_ZOOM,
            pitch: 70,
          }}
          followZoomLevel={INITIAL_MAP_ZOOM}
          followPitch={70}
          followUserMode={MapboxGL.UserTrackingMode.Follow}
          followUserLocation={isFollowingUser}
        />
        <MapboxGL.UserLocation
          visible
          onUpdate={(u) => setLastLocation({ lat: u.coords.latitude, lng: u.coords.longitude })}
        />
        {routeShape ? (
          <MapboxGL.ShapeSource id="active-walk-route" shape={routeShape}>
            <MapboxGL.LineLayer
              id="active-walk-route-line"
              style={{
                lineColor: '#0EA5E9',
                lineWidth: 5,
                lineOpacity: 0.82,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        ) : null}
        <CompanionLayer
          visible={companion.visible}
          position={companion.position}
          sprite={companion.sprite}
        />
        {(nearbyQuery.data ?? []).map((e) => {
          const dimmed =
            isCollectInFlight && 'entityId' in collectUi && collectUi.entityId === e.id;
          return (
            <MapboxGL.PointAnnotation
              key={e.id}
              id={e.id}
              coordinate={[e.location.longitude, e.location.latitude]}
              onSelected={() => {
                if (isCollectInFlight) return;
                if (!activeWalk) {
                  Alert.alert('Start a walk', 'Start a walk to collect nearby items.');
                  return;
                }
                if (activeWalk.status === 'paused') {
                  Alert.alert('Walk paused', 'Resume your walk to collect nearby items.');
                  return;
                }
                if (!collectable(e)) {
                  const d = liveDistanceTo(e);
                  Alert.alert(
                    'Too far',
                    d === null
                      ? 'Waiting for a GPS fix. Try again in a second.'
                      : `You're ${Math.round(d)}m away (±${Math.round(liveAccuracyM)}m); need to be within ${e.collectionRadiusMeters}m.`,
                  );
                  return;
                }
                collectMutation.mutate(e);
              }}
            >
              <View style={[styles.marker, dimmed && styles.markerDimmed]} />
            </MapboxGL.PointAnnotation>
          );
        })}
      </MapboxGL.MapView>
      <View style={styles.walkPanel}>
        <View style={styles.walkMetrics}>
          <Metric label="moving" value={formatDuration(movingSeconds)} />
          <Metric label="distance" value={`${Math.round(activeWalk?.distanceMeters ?? 0)}m`} />
          <Metric label="steps" value={`${activeWalk?.stepCount ?? 0}`} />
        </View>
        {activeWalk && pausedSeconds > 0 ? (
          <Text style={styles.pausedText}>Paused {formatDuration(pausedSeconds)}</Text>
        ) : null}
        <View style={styles.walkActions}>
          {!activeWalk ? (
            <Pressable
              accessibilityRole="button"
              style={styles.primaryWalkButton}
              onPress={() => void startWalk(movement.latest?.location ?? null)}
            >
              <Text style={styles.primaryWalkButtonText}>Start Walk</Text>
            </Pressable>
          ) : activeWalk.status === 'paused' ? (
            <>
              <Pressable
                accessibilityRole="button"
                style={styles.primaryWalkButton}
                onPress={() => void resumeWalk(movement.latest?.location ?? null)}
              >
                <Text style={styles.primaryWalkButtonText}>Resume</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryWalkButton}
                onPress={() => void endAndOpenWalk()}
              >
                <Text style={styles.secondaryWalkButtonText}>End</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryWalkButton}
                onPress={() => void pauseWalk()}
              >
                <Text style={styles.secondaryWalkButtonText}>Pause</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.dangerWalkButton}
                onPress={() => void endAndOpenWalk()}
              >
                <Text style={styles.dangerWalkButtonText}>End</Text>
              </Pressable>
            </>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.gusButton}
          onPress={() => navigation.navigate('Chat')}
        >
          <Text style={styles.gusButtonText}>Gus</Text>
        </Pressable>
      </View>
      {activeWalk && recoveryPromptPending ? (
        <View style={styles.recoveryPanel}>
          <Text style={styles.recoveryTitle}>Unfinished walk</Text>
          <Text style={styles.recoveryText}>
            ParkWalk found a walk that was not ended. Save it up to the last reliable movement,
            or discard it.
          </Text>
          <View style={styles.walkActions}>
            <Pressable
              accessibilityRole="button"
              style={styles.primaryWalkButton}
              onPress={() =>
                void endWalk({
                  recovered: true,
                  reason: 'app_reopened_with_unfinished_walk',
                  endedAt: activeWalk.lastMovementAt,
                }).then(openCompletedWalk)
              }
            >
              <Text style={styles.primaryWalkButtonText}>Save Walk</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.dangerWalkButton}
              onPress={() => void discardActiveWalk()}
            >
              <Text style={styles.dangerWalkButtonText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {showRecenterButton ? (
        <Pressable
          accessibilityLabel="Center map on your location"
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => [styles.recenterButton, pressed && styles.recenterButtonPressed]}
          onPress={recenterOnUser}
        >
          <View style={styles.navigationArrow} />
        </Pressable>
      ) : null}
      {SHOW_FIELD_DIAGNOSTICS ? (
        fieldDiagnosticsExpanded && !recoveryPromptPending ? (
          <View style={styles.debugOverlay}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugHeaderText}>Field diagnostics</Text>
              <Pressable
                accessibilityLabel="Collapse field diagnostics"
                accessibilityRole="button"
                hitSlop={8}
                style={styles.debugToggleButton}
                onPress={() => setFieldDiagnosticsExpanded(false)}
              >
                <Text style={styles.debugToggleText}>Hide</Text>
              </Pressable>
            </View>
            <Text style={styles.debugText}>
              state: <Text style={styles.debugBold}>{movement.summary?.state ?? 'UNKNOWN'}</Text>
              {'\n'}speed: {movement.summary?.averageSpeedMps.toFixed(2) ?? '0.00'} m/s
              {'\n'}step rate: {(movement.summary?.stepRateHz ?? 0).toFixed(2)} Hz
              {'\n'}gps ±{(movement.summary?.averageAccuracyMeters ?? 0).toFixed(0)}m
              {'\n'}entities: {nearbyQuery.data?.length ?? 0}
              {'\n'}walk:{' '}
              <Text style={styles.debugBold}>
                {activeWalk ? `${activeWalk.status} ${Math.round(activeWalk.distanceMeters)}m` : 'none'}
              </Text>
              {'\n'}nearest:{' '}
              <Text style={styles.debugBold}>
                {nearest
                  ? `${Math.round(nearest.distance)}m ±${Math.round(liveAccuracyM)}m (need ≤${nearest.entity.collectionRadiusMeters}m)`
                  : '-'}
              </Text>
              {'\n'}collect: <Text style={styles.debugBold}>{describeCollectUi(collectUi)}</Text>
            </Text>
          </View>
        ) : (
          <Pressable
            accessibilityLabel="Expand field diagnostics"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.debugChip}
            onPress={() => {
              if (!recoveryPromptPending) setFieldDiagnosticsExpanded(true);
            }}
          >
            <Text style={styles.debugChipText}>
              Field: {movement.summary?.state ?? 'UNKNOWN'}
              {activeWalk ? ` · ${Math.round(activeWalk.distanceMeters)}m` : ''}
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function roundKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function isCoordinateInBounds(coordinate: Position, bounds: VisibleBounds): boolean {
  const [lng, lat] = coordinate;
  const [east, north] = bounds.ne;
  const [west, south] = bounds.sw;
  const isInLatitude = lat >= south && lat <= north;
  const isInLongitude = west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
  return isInLatitude && isInLongitude;
}

function describeCollectUi(ui: CollectUiState): string {
  switch (ui.kind) {
    case 'idle':
      return 'idle';
    case 'sending':
      return 'sending';
    case 'retrying':
      return `retry ${ui.attempt}/${ui.maxAttempts}`;
  }
}

function toVisibleBounds(bounds: unknown): VisibleBounds | null {
  if (typeof bounds !== 'object' || bounds === null) return null;
  const candidate = bounds as Partial<VisibleBounds>;
  if (!isPosition(candidate.ne) || !isPosition(candidate.sw)) return null;
  return { ne: candidate.ne, sw: candidate.sw };
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: { error?: { code?: string; message?: string } };
  };
  message?: string;
  code?: string;
}

function categorizeError(err: unknown): { title: string; message: string } {
  const e = (typeof err === 'object' && err !== null ? err : {}) as AxiosLikeError;
  const status = e.response?.status;
  const serverCode = e.response?.data?.error?.code;
  const serverMessage = e.response?.data?.error?.message;

  if (serverCode === 'OUT_OF_RANGE' || serverCode === 'DISTANCE_TOO_FAR') {
    return { title: 'Too far', message: serverMessage ?? 'Walk closer and try again.' };
  }
  if (serverCode === 'ALREADY_COLLECTED') {
    return {
      title: 'Already collected',
      message: serverMessage ?? "You've already collected this.",
    };
  }
  if (serverCode === 'MOVEMENT_INVALID') {
    return {
      title: 'Movement not accepted',
      message: serverMessage ?? 'The server rejected this walk as not on foot.',
    };
  }
  if (serverCode === 'WALK_REQUIRED') {
    return {
      title: 'Start a walk',
      message: serverMessage ?? 'Start a walk to collect nearby items.',
    };
  }
  if (status === 429) {
    return { title: 'Slow down', message: 'Too many collect attempts. Wait a moment.' };
  }
  if (err instanceof Error && !e.response) {
    return {
      title: 'Cannot collect',
      message: err.message,
    };
  }
  // No response at all = ran out of retries, still couldn't reach server.
  if (!e.response) {
    return {
      title: 'Network trouble',
      message: 'Could not reach the server after retrying. Check wifi/cellular and try again.',
    };
  }
  return {
    title: 'Cannot collect',
    message: serverMessage ?? e.message ?? 'Unknown error',
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  walkPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 5,
  },
  walkMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metric: {
    alignItems: 'center',
    minWidth: 72,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  metricLabel: {
    marginTop: 1,
    fontSize: 11,
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  pausedText: {
    marginBottom: 8,
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '700',
  },
  walkActions: {
    flexDirection: 'row',
    gap: 8,
  },
  gusButton: {
    marginTop: 8,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gusButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '800',
  },
  recoveryPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 16,
    zIndex: 30,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  recoveryTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  recoveryText: {
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 12,
  },
  primaryWalkButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryWalkButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryWalkButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryWalkButtonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  dangerWalkButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerWalkButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3B82F6',
    borderColor: 'white',
    borderWidth: 2,
  },
  markerDimmed: {
    opacity: 0.4,
  },
  recenterButton: {
    position: 'absolute',
    right: 18,
    bottom: 154,
    zIndex: 12,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
  },
  recenterButtonPressed: {
    opacity: 0.75,
  },
  navigationArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 26,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#2563EB',
    transform: [{ rotate: '45deg' }, { translateY: -1 }],
  },
  debugOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 20,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  debugHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  debugHeaderText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  debugToggleButton: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#E5E7EB',
  },
  debugToggleText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  debugChip: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 8,
    maxWidth: '72%',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  debugChipText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  debugText: {
    fontSize: 12,
    color: '#333',
  },
  debugBold: {
    fontWeight: '600',
  },
});
