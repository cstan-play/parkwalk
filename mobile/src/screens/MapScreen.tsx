import type { GameEntity } from '@parkwalk/shared';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapboxGL, { type Camera as MapboxCamera, type MapState } from '@rnmapbox/maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Position } from 'geojson';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Image,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Config from 'react-native-config';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompanionLayer } from '@/components/CompanionLayer';
import { SmellToast } from '@/components/ui/SmellToast';
import { PARKWALK_MAP_STYLE_URL } from '@/config/mapStyle';
import { useCompanion } from '@/hooks/useCompanion';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { useMovementDetection } from '@/hooks/useMovementDetection';
import { useWalkSession } from '@/hooks/useWalkSession';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { schedulePostWalkDebrief } from '@/notifications/scheduler';
import { onRetry } from '@/services/apiClient';
import { collectEntity, fetchNearby } from '@/services/entitiesApi';
import { playSmellFound } from '@/services/soundCue';
import {
  getPausedDurationSeconds,
  useWalkSessionStore,
  type LocalWalkSession,
  type SmellCollection,
} from '@/stores/walkSessionStore';
import { haversineMeters } from '@/util/geo';

const COLLECT_COOLDOWN_MS = 4_000;
// `impactLight` on Android is a sub-perceptible ~10 ms tick on most hardware;
// `impactMedium` maps to EFFECT_HEAVY_CLICK and is reliably felt. We also
// ignore the Android system haptic setting because the collect haptic is an
// explicit user-action signal, not ambient feedback.
const HAPTIC_TYPE = 'impactMedium' as const;
const HAPTIC_OPTIONS = { enableVibrateFallback: true, ignoreAndroidSystemSettings: true };

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
  const insets = useSafeAreaInsets();
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-collect bookkeeping. pendingRef holds entity ids whose mutation is
  // in flight; cooldownRef holds entity ids -> unblock epoch (post-failure).
  // Both are refs (not state) so updating them never re-runs the effect on
  // its own — only the GPS/state dep changes do. The effect re-runs on every
  // movement sample and consults these to avoid double-firing.
  const pendingRef = useRef<Set<string>>(new Set());
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
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
      if (following) {
        setShowRecenterButton(false);
        return;
      }
      // bbox visibility is only reliable near pitch=0. At higher pitch the
      // reported bounds extends far past the visible trapezoid (toward the
      // horizon), so isCoordinateInBounds returns true even when the user is
      // clearly off-screen. Fall back to "show whenever not following" when
      // the camera is tilted.
      if (cameraStateRef.current.pitch > 5) {
        setShowRecenterButton(true);
        return;
      }
      const userIsVisible = isCoordinateInBounds(latestUserCoordinate, bounds);
      setShowRecenterButton(!userIsVisible);
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
      pendingRef.current.delete(entity.id);
      setCollectUi({ kind: 'idle' });
      const smellMeta = extractSmellMeta(entity);
      void markCollected(entity.id, smellMeta);
      const points = Number((entity.config as { points?: number }).points ?? 0);
      const label = smellMeta?.name ?? 'Mystery smell';
      setToastMessage(`Gus found ${label}\n+${points} smell points`);
      playSmellFound();
      try {
        ReactNativeHapticFeedback.trigger(HAPTIC_TYPE, HAPTIC_OPTIONS);
      } catch {
        // Haptic is best-effort; never block the collect on it.
      }
      void queryClient.invalidateQueries({ queryKey: ['nearby'] });
      void queryClient.invalidateQueries({ queryKey: ['myStats'] });
    },
    onError: (err: unknown, entity) => {
      pendingRef.current.delete(entity.id);
      cooldownRef.current.set(entity.id, Date.now() + COLLECT_COOLDOWN_MS);
      setCollectUi({ kind: 'idle' });
      const category = categorizeError(err);
      // Stay quiet on transient infra errors — the cooldown will retry.
      // Surface only when the failure is user-relevant (out of range,
      // movement validation, walk gating).
      if (category.surface === 'show') {
        setToastMessage(category.title);
      }
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

  /**
   * Auto-collect drain effect.
   *
   * Runs on every movement/state change. Picks the closest still-viable
   * candidate (collectable, not already in this walk, not in pendingRef,
   * not in active cooldown) and fires a collect. Concurrency is limited
   * to 1 by the collectUi.kind === 'idle' guard — the next candidate is
   * only considered after the in-flight mutation resolves.
   *
   * Net behavior in a cluster: serial collects, one round-trip each.
   * Stops naturally when no candidate remains.
   */
  useEffect(() => {
    if (!activeWalk || activeWalk.status !== 'active') return;
    if (collectUi.kind !== 'idle') return;
    if (appStateRef.current !== 'active') return;
    if (!livePoint) return;

    const candidates = (nearbyQuery.data ?? [])
      .filter((entity) => !activeWalk.collectedEntityIds.includes(entity.id))
      .filter((entity) => !pendingRef.current.has(entity.id))
      .filter((entity) => {
        const unblockAt = cooldownRef.current.get(entity.id);
        return unblockAt === undefined || Date.now() >= unblockAt;
      })
      .filter((entity) => collectable(entity));

    if (candidates.length === 0) return;

    let bestEntity: GameEntity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entity of candidates) {
      const d = haversineMeters(livePoint, entity.location);
      if (d < bestDistance) {
        bestDistance = d;
        bestEntity = entity;
      }
    }
    if (!bestEntity) return;

    pendingRef.current.add(bestEntity.id);
    collectMutation.mutate(bestEntity);
    // Deps trimmed deliberately: `collectable`, `collectMutation`, and other
    // closures are re-created every render. Including them would re-run this
    // effect every tick. The listed deps cover every state transition that
    // should retrigger the drain (walk state, collected count, in-flight
    // collect, live GPS, nearby snapshot).
  }, [
    activeWalk?.status,
    activeWalk?.collectedEntityIds.length,
    collectUi.kind,
    livePoint,
    nearbyQuery.data,
  ]);
  const nowIso = useMemo(() => new Date(nowTick).toISOString(), [nowTick]);
  const pausedSeconds = activeWalk ? getPausedDurationSeconds(activeWalk.pauseIntervals, nowIso) : 0;
  const walkElapsedSeconds = activeWalk
    ? Math.max(0, Math.round((nowTick - Date.parse(activeWalk.startedAt)) / 1000) - pausedSeconds)
    : 0;
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

  const primaryWalkLabel = !activeWalk
    ? 'Start Walk'
    : activeWalk.status === 'paused'
      ? 'Resume'
      : 'Pause';
  const primaryWalkIcon = !activeWalk ? '👣' : activeWalk.status === 'paused' ? '▶' : 'Ⅱ';
  const handlePrimaryWalkAction = useCallback(() => {
    if (!activeWalk) {
      void startWalk(movement.latest?.location ?? null);
      return;
    }
    if (activeWalk.status === 'paused') {
      void resumeWalk(movement.latest?.location ?? null);
      return;
    }
    void pauseWalk();
  }, [activeWalk, movement.latest?.location, pauseWalk, resumeWalk, startWalk]);

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
          const isInFlight =
            isCollectInFlight && 'entityId' in collectUi && collectUi.entityId === e.id;
          const alreadyCollected = activeWalk?.collectedEntityIds.includes(e.id) ?? false;
          const dimmed = isInFlight || alreadyCollected;
          // Markers are passive in Phase 7 — collection is driven by the
          // proximity-based effect above, not by taps.
          return (
            <MapboxGL.PointAnnotation
              key={e.id}
              id={e.id}
              coordinate={[e.location.longitude, e.location.latitude]}
            >
              <View style={[styles.marker, dimmed && styles.markerDimmed]} />
            </MapboxGL.PointAnnotation>
          );
        })}
      </MapboxGL.MapView>
      <View
        style={[
          styles.topNav,
          activeWalk && styles.activeTopNav,
          { paddingTop: insets.top + (activeWalk ? 20 : 38) },
        ]}
      >
        {activeWalk ? (
          <View style={styles.walkingHeader}>
            <View style={styles.walkingAvatarRing}>
              <Image
                source={require('../assets/onboarding/gus-avatar.png')}
                style={styles.walkingAvatar}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </View>
            <View>
              <Text style={styles.walkingTitle}>Walking with Gus</Text>
              <View style={styles.walkingStatusRow}>
                <View
                  style={[
                    styles.walkingStatusDot,
                    activeWalk.status === 'paused' && styles.walkingStatusDotPaused,
                  ]}
                />
                <Text
                  style={[
                    styles.walkingStatusText,
                    activeWalk.status === 'paused' && styles.walkingStatusTextPaused,
                  ]}
                >
                  {activeWalk.status === 'paused' ? 'Paused' : 'Live'}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            <MapTopNavItem icon="🌤️" label="21°" />
            <MapTopNavItem icon="📖" label="Stats" onPress={() => navigation.navigate('Stats')} />
            <MapTopNavItem
              icon="🗺️"
              label="Walks"
              onPress={() => navigation.navigate('WalkHistory')}
            />
            <MapTopNavItem
              icon="⚙️"
              label="Settings"
              onPress={() => navigation.navigate('Settings')}
            />
          </>
        )}
      </View>
      <View
        style={[
          styles.bottomNav,
          activeWalk && styles.activeBottomNav,
          { paddingBottom: insets.bottom + (activeWalk ? 10 : 22) },
        ]}
      >
        {activeWalk ? (
          <>
            <View style={styles.walkMetrics} accessible accessibilityLabel="Walk stats">
              <WalkMetric label="Time" value={formatDuration(walkElapsedSeconds)} />
              <WalkMetric label="Distance" value={formatDistance(activeWalk.distanceMeters)} />
              <WalkMetric label="Steps" value={activeWalk.stepCount.toLocaleString()} />
              <WalkMetric label="Smells" value={`${activeWalk.collectedEntityIds.length}`} />
            </View>
            <View style={styles.bottomNavItems}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Wall"
                style={({ pressed }) => [styles.bottomNavItem, pressed && styles.bottomNavItemPressed]}
                onPress={() => navigation.navigate('Wall')}
              >
                <Text style={styles.wallIcon}>🪧</Text>
                <Text style={styles.bottomNavText}>Wall</Text>
              </Pressable>
              <View style={styles.primaryWalkSlot}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={primaryWalkLabel}
                  style={({ pressed }) => [
                    styles.primaryWalkCircle,
                    styles.activePrimaryWalkCircle,
                    activeWalk.status === 'paused' && styles.resumeWalkCircle,
                    pressed && styles.primaryWalkCirclePressed,
                  ]}
                  onPress={handlePrimaryWalkAction}
                >
                  <Text
                    style={[
                      styles.primaryWalkIcon,
                      activeWalk.status === 'paused' && styles.resumeWalkCircleText,
                    ]}
                  >
                    {primaryWalkIcon}
                  </Text>
                </Pressable>
                <Text
                  style={[
                    styles.bottomNavText,
                    styles.primaryWalkLabel,
                    activeWalk.status === 'paused' && styles.resumeWalkCircleText,
                  ]}
                >
                  {primaryWalkLabel}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Chat with Gus"
                style={({ pressed }) => [styles.bottomNavItem, pressed && styles.bottomNavItemPressed]}
                onPress={() => navigation.navigate('Chat')}
              >
                <Image
                  source={require('../assets/onboarding/gus-avatar.png')}
                  style={styles.chatIcon}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
                <Text style={styles.bottomNavText}>Chat</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.endWalkButton, pressed && styles.endWalkButtonPressed]}
              onPress={() => void endAndOpenWalk()}
            >
              <Text style={styles.endWalkButtonIcon}>■</Text>
              <Text style={styles.endWalkButtonText}>End Walk</Text>
            </Pressable>
            {pausedSeconds > 0 ? (
              <Text style={styles.pausedText}>Paused {formatDuration(pausedSeconds)}</Text>
            ) : null}
          </>
        ) : (
          <View style={styles.bottomNavItems}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Wall"
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.bottomNavItemPressed]}
              onPress={() => navigation.navigate('Wall')}
            >
              <Text style={styles.wallIcon}>🪧</Text>
              <Text style={styles.bottomNavText}>Wall</Text>
            </Pressable>
            <View style={styles.primaryWalkSlot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={primaryWalkLabel}
                style={({ pressed }) => [
                  styles.primaryWalkCircle,
                  pressed && styles.primaryWalkCirclePressed,
                ]}
                onPress={handlePrimaryWalkAction}
              >
                <Text style={styles.primaryWalkIcon}>{primaryWalkIcon}</Text>
              </Pressable>
              <Text style={[styles.bottomNavText, styles.primaryWalkLabel]}>
                {primaryWalkLabel}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Chat with Gus"
              style={({ pressed }) => [styles.bottomNavItem, pressed && styles.bottomNavItemPressed]}
              onPress={() => navigation.navigate('Chat')}
            >
              <Image
                source={require('../assets/onboarding/gus-avatar.png')}
                style={styles.chatIcon}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.bottomNavText}>Chat</Text>
            </Pressable>
          </View>
        )}
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
          style={({ pressed }) => [
            styles.recenterButton,
            activeWalk && styles.activeRecenterButton,
            pressed && styles.recenterButtonPressed,
          ]}
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
      <SmellToast message={toastMessage} onHidden={() => setToastMessage(null)} />
    </View>
  );
}

function WalkMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function MapTopNavItem({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress?: () => void;
}): JSX.Element {
  const content = (
    <>
      <Text style={styles.topNavIcon}>{icon}</Text>
      <Text style={styles.topNavLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {label}
      </Text>
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.topNavItem} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.topNavItem, pressed && styles.topNavItemPressed]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function roundKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Reads smell meta from an entity's config (typed in Phase 5). Returns null
 * for legacy entities whose config predates the smellType field — those
 * still mark collected but show up in `byType: {}` on the detail summary.
 */
function extractSmellMeta(entity: GameEntity): SmellCollection | undefined {
  const config = (entity.config ?? {}) as {
    smellType?: unknown;
    name?: unknown;
    points?: unknown;
    gusFlavor?: unknown;
  };
  const smellType = config.smellType;
  if (!isSmellType(smellType)) return undefined;
  return {
    entityId: entity.id,
    smellType,
    name: typeof config.name === 'string' ? config.name : 'Mystery smell',
    points: typeof config.points === 'number' ? config.points : 0,
    collectedAt: new Date().toISOString(),
    gusFlavor: typeof config.gusFlavor === 'string' ? config.gusFlavor : undefined,
  };
}

const SMELL_TYPE_SET: ReadonlySet<string> = new Set([
  'other_dogs_pee',
  'real_poop',
  'picked_up_poop',
  'humans',
  'neighbours',
  'pigeons',
  'birds',
]);

function isSmellType(value: unknown): value is SmellCollection['smellType'] {
  return typeof value === 'string' && SMELL_TYPE_SET.has(value);
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

/**
 * `surface` is 'show' only for failures the user can act on (out of range,
 * movement validation, walk gating). Transient infra errors return 'silent'
 * — the cooldown handles the retry without bothering the user.
 */
function categorizeError(err: unknown): {
  title: string;
  message: string;
  surface: 'show' | 'silent';
} {
  const e = (typeof err === 'object' && err !== null ? err : {}) as AxiosLikeError;
  const status = e.response?.status;
  const serverCode = e.response?.data?.error?.code;
  const serverMessage = e.response?.data?.error?.message;

  if (serverCode === 'OUT_OF_RANGE' || serverCode === 'DISTANCE_TOO_FAR') {
    return {
      title: 'Too far',
      message: serverMessage ?? 'Walk closer and try again.',
      surface: 'show',
    };
  }
  if (serverCode === 'MOVEMENT_INVALID') {
    return {
      title: 'Movement not accepted',
      message: serverMessage ?? 'The server rejected this walk as not on foot.',
      surface: 'show',
    };
  }
  if (serverCode === 'ALREADY_COLLECTED') {
    return {
      title: 'Already collected',
      message: serverMessage ?? "You've already collected this.",
      surface: 'silent',
    };
  }
  if (serverCode === 'WALK_REQUIRED') {
    return {
      title: 'Start a walk',
      message: serverMessage ?? 'Start a walk to collect nearby items.',
      surface: 'silent',
    };
  }
  if (status === 429) {
    return {
      title: 'Slow down',
      message: 'Too many collect attempts. Wait a moment.',
      surface: 'silent',
    };
  }
  if (err instanceof Error && !e.response) {
    return { title: 'Cannot collect', message: err.message, surface: 'silent' };
  }
  if (!e.response) {
    return {
      title: 'Network trouble',
      message: 'Could not reach the server after retrying. Check wifi/cellular and try again.',
      surface: 'silent',
    };
  }
  return {
    title: 'Cannot collect',
    message: serverMessage ?? e.message ?? 'Unknown error',
    surface: 'silent',
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  topNav: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 12,
    minHeight: 118,
    paddingHorizontal: 18,
    paddingBottom: 21,
    borderBottomLeftRadius: 21,
    borderBottomRightRadius: 21,
    backgroundColor: '#f7efe5',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10.5,
    elevation: 8,
  },
  activeTopNav: {
    minHeight: 96,
    paddingBottom: 10,
  },
  topNavItem: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  topNavItemPressed: {
    opacity: 0.65,
  },
  topNavIcon: {
    fontSize: 19.4,
    lineHeight: 24,
    marginBottom: 2,
  },
  topNavLabel: {
    color: '#000',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  walkingHeader: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 0,
  },
  walkingAvatarRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    borderColor: '#c89f78',
    backgroundColor: '#fffaf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  walkingAvatar: {
    width: 42,
    height: 42,
  },
  walkingTitle: {
    color: '#000',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  walkingStatusRow: {
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  walkingStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 4,
    backgroundColor: '#76bc67',
  },
  walkingStatusDotPaused: {
    backgroundColor: '#c69f7a',
  },
  walkingStatusText: {
    color: '#76bc67',
    fontSize: 12,
    lineHeight: 22,
    fontWeight: '500',
  },
  walkingStatusTextPaused: {
    color: '#9b6e45',
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12,
    minHeight: 145,
    paddingTop: 45,
    paddingHorizontal: 35,
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    backgroundColor: '#f7efe5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.13,
    shadowRadius: 10.5,
    elevation: 8,
  },
  activeBottomNav: {
    minHeight: 286,
    paddingTop: 18,
  },
  bottomNavItems: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  bottomNavItem: {
    width: 74,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bottomNavItemPressed: {
    opacity: 0.65,
  },
  bottomNavText: {
    color: '#000',
    fontSize: 18,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryWalkLabel: {
    fontWeight: '700',
  },
  wallIcon: {
    fontSize: 34.2,
    lineHeight: 47,
    marginBottom: 1,
  },
  chatIcon: {
    width: 48,
    height: 36,
    marginBottom: 10,
  },
  primaryWalkSlot: {
    width: 108,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  primaryWalkCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    marginTop: -80,
    marginBottom: 16,
    borderWidth: 7,
    borderColor: '#ffffff',
    backgroundColor: '#ead9c5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.13,
    shadowRadius: 7,
    elevation: 6,
  },
  primaryWalkCirclePressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  resumeWalkCircle: {
    backgroundColor: '#cce8c4',
  },
  resumeWalkCircleText: {
    color: '#1e5b2a',
  },
  primaryWalkIcon: {
    color: '#2c2724',
    fontSize: 42,
    lineHeight: 55,
    fontWeight: '700',
    textAlign: 'center',
  },
  activePrimaryWalkCircle: {
    marginTop: 0,
  },
  walkMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
    marginBottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 19,
    backgroundColor: '#f0e4d4',
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  metricValue: {
    color: '#000',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    maxWidth: '100%',
  },
  metricLabel: {
    marginTop: 1,
    color: '#7b6a58',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  liveWalkFooter: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pausedText: {
    marginTop: 5,
    textAlign: 'left',
    color: '#7b6a58',
    fontSize: 12,
    fontWeight: '800',
  },
  walkActions: {
    flexDirection: 'row',
    gap: 8,
  },
  endWalkButton: {
    minHeight: 54,
    marginTop: 18,
    borderRadius: 16,
    backgroundColor: '#d9412e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  endWalkButtonPressed: {
    opacity: 0.82,
  },
  endWalkButtonIcon: {
    color: '#f0e4d4',
    fontSize: 18,
    lineHeight: 22,
    marginRight: 14,
  },
  endWalkButtonText: {
    color: '#f0e4d4',
    fontSize: 16,
    lineHeight: 22,
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
    bottom: 232,
    zIndex: 40,
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
    elevation: 20,
  },
  activeRecenterButton: {
    bottom: 310,
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
