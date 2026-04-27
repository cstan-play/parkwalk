import MapboxGL from '@rnmapbox/maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Config from 'react-native-config';
import type { GameEntity } from '@parkwalk/shared';
import type { Position } from 'geojson';

import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { useMovementDetection } from '@/hooks/useMovementDetection';
import { onRetry } from '@/services/apiClient';
import { collectEntity, fetchNearby } from '@/services/entitiesApi';
import { haversineMeters } from '@/util/geo';

// Mirrors `MAX_ACCURACY_TOLERANCE_M` on the backend. Cap applied to the user's
// reported horizontal accuracy before subtracting it from the measured
// distance to an entity; prevents inflated-uncertainty "teleport" collects.
const MAX_ACCURACY_TOLERANCE_M = 35;
const DEFAULT_CENTER_COORDINATE: Position = [-122.4194, 37.7749];
const SHOW_FIELD_DIAGNOSTICS = __DEV__ || Config.FIELD_DEBUG_OVERLAY === 'true';

type VisibleBounds = { ne: Position; sw: Position };

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
  const isFollowingUserRef = useRef(true);
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [collectUi, setCollectUi] = useState<CollectUiState>({ kind: 'idle' });
  const [isFollowingUser, setIsFollowingUser] = useState(true);
  const [showRecenterButton, setShowRecenterButton] = useState(false);
  const idem = useIdempotencyKey();
  const queryClient = useQueryClient();

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
      if (!movement.summary || !movement.latest) {
        throw new Error('No movement summary yet; stand still for a second and try again');
      }
      const key = idem.next();
      setCollectUi({ kind: 'sending', entityId: entity.id, idempotencyKey: key });
      return await collectEntity(key, {
        entityId: entity.id,
        location: movement.latest.location,
        summary: movement.summary,
        samples: movement.samples,
        clientSentAt: new Date().toISOString(),
      });
    },
    onSuccess: (_data, entity) => {
      setCollectUi({ kind: 'idle' });
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

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        onDidFinishLoadingMap={() => undefined}
        onCameraChanged={(state) => {
          if (!state.gestures?.isGestureActive) return;
          setFollowingUser(false);
          const bounds = toVisibleBounds(state.properties?.bounds);
          if (bounds) {
            updateRecenterVisibility(bounds, false);
          }
        }}
        logoEnabled={false}
        attributionEnabled={true}
      >
        <MapboxGL.Camera
          zoomLevel={16}
          centerCoordinate={centerCoords}
          followZoomLevel={16}
          followUserMode={MapboxGL.UserTrackingMode.Follow}
          followUserLocation={isFollowingUser}
        />
        <MapboxGL.UserLocation
          visible
          onUpdate={(u) => setLastLocation({ lat: u.coords.latitude, lng: u.coords.longitude })}
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
      {showRecenterButton ? (
        <Pressable
          accessibilityLabel="Center map on your location"
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => [styles.recenterButton, pressed && styles.recenterButtonPressed]}
          onPress={() => {
            if (!latestUserCoordinate) return;
            setFollowingUser(true);
            setShowRecenterButton(false);
          }}
        >
          <View style={styles.navigationArrow} />
        </Pressable>
      ) : null}
      {SHOW_FIELD_DIAGNOSTICS ? (
        <View style={styles.debugOverlay} pointerEvents="none">
          <Text style={styles.debugText}>
            state: <Text style={styles.debugBold}>{movement.summary?.state ?? 'UNKNOWN'}</Text>
            {'\n'}speed: {movement.summary?.averageSpeedMps.toFixed(2) ?? '0.00'} m/s
            {'\n'}step rate: {(movement.summary?.stepRateHz ?? 0).toFixed(2)} Hz
            {'\n'}gps ±{(movement.summary?.averageAccuracyMeters ?? 0).toFixed(0)}m{'\n'}entities:{' '}
            {nearbyQuery.data?.length ?? 0}
            {'\n'}nearest:{' '}
            <Text style={styles.debugBold}>
              {nearest
                ? `${Math.round(nearest.distance)}m ±${Math.round(liveAccuracyM)}m (need ≤${nearest.entity.collectionRadiusMeters}m)`
                : '-'}
            </Text>
            {'\n'}collect: <Text style={styles.debugBold}>{describeCollectUi(collectUi)}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
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
  if (status === 429) {
    return { title: 'Slow down', message: 'Too many collect attempts. Wait a moment.' };
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
    bottom: 30,
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
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  debugText: {
    fontSize: 12,
    color: '#333',
  },
  debugBold: {
    fontWeight: '600',
  },
});
