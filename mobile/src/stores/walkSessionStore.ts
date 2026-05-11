import type {
  Location,
  MovementSample,
  SmellType,
  SyncWalkRequest,
  WalkPathPoint,
  WalkPathSegment,
} from '@parkwalk/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { queryPedometerSteps } from '@/native/Pedometer';
import { syncWalk } from '@/services/walksApi';
import { describeApiError } from '@/util/describeApiError';
import { haversineMeters } from '@/util/geo';

const LEGACY_STORAGE_KEY = 'parkwalk.walk_sessions.v1';
const PREVIOUS_STORAGE_KEY_PREFIX = 'parkwalk.walk_sessions.v2';
const STORAGE_KEY_PREFIX = 'parkwalk.walk_sessions.v3';
const MAX_ACCURACY_METERS = 50;
const MIN_SEGMENT_METERS = 2;
const IMPOSSIBLE_SPEED_MPS = 8;
const PERSIST_INTERVAL_MS = 10_000;
const PEDOMETER_QUERY_TIMEOUT_MS = 2_500;
const MAX_SYNCED_HISTORY = 100;

export type ActiveWalkStatus = 'active' | 'paused';
export type CompletedWalkStatus = 'completed' | 'auto_completed' | 'recovered_after_termination';
export type SyncState = 'pending' | 'syncing' | 'synced' | 'failed';

export interface WalkPauseInterval {
  startedAt: string;
  endedAt?: string;
}

export interface WalkStepInterval {
  startedAt: string;
  endedAt: string;
}

export interface LocalWalkPathSegment {
  startedAt: string;
  endedAt?: string;
  points: WalkPathPoint[];
}

export interface SimpleLocation {
  latitude: number;
  longitude: number;
}

export interface SmellCollection {
  entityId: string;
  smellType: SmellType;
  name: string;
  points: number;
  collectedAt: string;
  gusFlavor?: string;
}

export interface LocalWalkSession {
  clientId: string;
  status: ActiveWalkStatus | CompletedWalkStatus;
  startedAt: string;
  endedAt?: string;
  pauseIntervals: WalkPauseInterval[];
  pathSegments: LocalWalkPathSegment[];
  distanceMeters: number;
  stepCount: number;
  collectedEntityIds: string[];
  lastMovementAt: string;
  lastAutoPromptAt?: string;
  activeStepIntervals: WalkStepInterval[];
  currentStepIntervalStartedAt?: string;
  nativeStepBase?: number;
  currentNativeIntervalSteps?: number;
  syncState: SyncState;
  serverId?: string;
  syncError?: string;
  autoFinished?: boolean;
  autoFinishReason?: string | null;
  usesNativeSteps?: boolean;
  /** Captured at startWalk() from `initialLocation`; used as a fallback for
   *  the detail map center when the walk has no GPS samples. */
  startLocation?: SimpleLocation;
  /**
   * Per-walk smell rollup with full meta. Mirrors `collectedEntityIds` but
   * carries the smellType/name/points read from the entity's config at
   * collect time. Defaults to [] on rehydrate of older AsyncStorage rows.
   */
  collectedSmells: SmellCollection[];
}

interface PersistedState {
  ownerId: string | null;
  activeSession: LocalWalkSession | null;
  completedSessions: LocalWalkSession[];
  /** Latest GPS fix seen by any active walk's `recordMovementSample`. Persisted
   *  so it survives restart and remains a last-resort center for the detail
   *  map of walks too short to have their own GPS samples. */
  lastKnownLocation?: SimpleLocation;
}

interface WalkSessionState extends PersistedState {
  hydrated: boolean;
  recoveryPromptPending: boolean;
  hydrate: (ownerId?: string | null) => Promise<void>;
  clearInMemory: () => void;
  clearRecoveryPrompt: () => void;
  startWalk: (initialLocation?: Location | null) => Promise<void>;
  pauseWalk: () => Promise<void>;
  resumeWalk: (initialLocation?: Location | null) => Promise<void>;
  endWalk: (opts?: { auto?: boolean; reason?: string; recovered?: boolean; endedAt?: string }) => Promise<LocalWalkSession | null>;
  discardActiveWalk: () => Promise<void>;
  recordMovementSample: (sample: MovementSample) => Promise<void>;
  setNativeStepCount: (steps: number, recordedAt?: string) => Promise<void>;
  markAutoPromptShown: () => Promise<void>;
  continueAfterAutoPrompt: () => Promise<void>;
  markCollected: (entityId: string, smellMeta?: SmellCollection) => Promise<void>;
  syncPendingWalks: () => Promise<void>;
}

let lastPersistAt = 0;
let pendingPersist: ReturnType<typeof setTimeout> | null = null;

export const useWalkSessionStore = create<WalkSessionState>((set, get) => ({
  ownerId: null,
  activeSession: null,
  completedSessions: [],
  hydrated: false,
  recoveryPromptPending: false,
  lastKnownLocation: undefined,

  hydrate: async (ownerId = null) => {
    const normalizedOwnerId = ownerId ?? null;
    if (get().hydrated && get().ownerId === normalizedOwnerId) return;
    if (get().ownerId !== normalizedOwnerId) {
      clearPendingPersist();
      set(emptyInMemoryState(normalizedOwnerId, false));
    }
    try {
      await removePreviousWalkStorage(normalizedOwnerId);
      const raw = await AsyncStorage.getItem(storageKeyForOwner(normalizedOwnerId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        const activeSession = parsed.activeSession ? normalizeLocalSession(parsed.activeSession) : null;
        set({
          ownerId: normalizedOwnerId,
          activeSession,
          completedSessions: parsed.completedSessions ?? [],
          hydrated: true,
          recoveryPromptPending: !!activeSession,
          lastKnownLocation: parsed.lastKnownLocation,
        });
        return;
      }
    } catch {
      // Ignore corrupt local history and start fresh.
    }
    set({
      ownerId: normalizedOwnerId,
      activeSession: null,
      completedSessions: [],
      hydrated: true,
      recoveryPromptPending: false,
      lastKnownLocation: undefined,
    });
  },

  clearInMemory: () => {
    clearPendingPersist();
    set(emptyInMemoryState(null, false));
  },

  clearRecoveryPrompt: () => set({ recoveryPromptPending: false }),

  startWalk: async (initialLocation) => {
    if (get().activeSession) return;
    const now = new Date().toISOString();
    const initialPoint = initialLocation ? toPathPoint(initialLocation, now, 0) : null;
    const startLocation: SimpleLocation | undefined = initialLocation
      ? { latitude: initialLocation.latitude, longitude: initialLocation.longitude }
      : undefined;
    const activeSession: LocalWalkSession = {
      clientId: createUuid(),
      status: 'active',
      startedAt: now,
      pauseIntervals: [],
      pathSegments: [{ startedAt: now, points: initialPoint ? [initialPoint] : [] }],
      distanceMeters: 0,
      stepCount: 0,
      collectedEntityIds: [],
      lastMovementAt: now,
      activeStepIntervals: [],
      currentStepIntervalStartedAt: now,
      nativeStepBase: 0,
      currentNativeIntervalSteps: 0,
      syncState: 'pending',
      autoFinished: false,
      autoFinishReason: null,
      startLocation,
      collectedSmells: [],
    };
    set({
      activeSession,
      recoveryPromptPending: false,
      lastKnownLocation: startLocation ?? get().lastKnownLocation,
    });
    await persist(get());
  },

  pauseWalk: async () => {
    const session = get().activeSession;
    if (!session || session.status !== 'active') return;
    const now = new Date().toISOString();
    const activeStepIntervals = closeActiveStepInterval(session, now);
    const pathSegments = closeActivePathSegment(session.pathSegments, now);
    set({
      activeSession: {
        ...session,
        status: 'paused',
        pathSegments,
        activeStepIntervals,
        currentStepIntervalStartedAt: undefined,
        nativeStepBase: session.stepCount,
        currentNativeIntervalSteps: 0,
        pauseIntervals: [...session.pauseIntervals, { startedAt: now }],
      },
    });
    await persist(get());
  },

  resumeWalk: async (initialLocation) => {
    const session = get().activeSession;
    if (!session || session.status !== 'paused') return;
    const now = new Date().toISOString();
    const initialPoint = initialLocation ? toPathPoint(initialLocation, now, session.stepCount) : null;
    const pauseIntervals = session.pauseIntervals.map((interval, index) =>
      index === session.pauseIntervals.length - 1 && !interval.endedAt
        ? { ...interval, endedAt: now }
        : interval,
    );
    set({
      activeSession: {
        ...session,
        status: 'active',
        pauseIntervals,
        pathSegments: [
          ...session.pathSegments,
          { startedAt: now, points: initialPoint ? [initialPoint] : [] },
        ],
        lastMovementAt: now,
        lastAutoPromptAt: undefined,
        currentStepIntervalStartedAt: now,
        currentNativeIntervalSteps: 0,
      },
      lastKnownLocation: initialLocation
        ? { latitude: initialLocation.latitude, longitude: initialLocation.longitude }
        : get().lastKnownLocation,
    });
    await persist(get());
  },

  endWalk: async (opts) => {
    const session = get().activeSession;
    if (!session) return null;
    const endedAt = opts?.endedAt ?? new Date().toISOString();
    const stepIntervals =
      session.status === 'active' ? closeActiveStepInterval(session, endedAt) : session.activeStepIntervals;
    const pathSegments =
      session.status === 'active'
        ? closeActivePathSegment(session.pathSegments, endedAt)
        : session.pathSegments;
    const pauseIntervals =
      session.status === 'paused'
        ? session.pauseIntervals.map((interval, index) =>
            index === session.pauseIntervals.length - 1 && !interval.endedAt
              ? { ...interval, endedAt }
              : interval,
          )
        : session.pauseIntervals;
    const completed: LocalWalkSession = {
      ...session,
      status: opts?.recovered ? 'recovered_after_termination' : opts?.auto ? 'auto_completed' : 'completed',
      endedAt,
      pauseIntervals,
      pathSegments,
      activeStepIntervals: stepIntervals,
      currentStepIntervalStartedAt: undefined,
      currentNativeIntervalSteps: 0,
      syncState: 'pending',
      autoFinished: !!opts?.auto,
      autoFinishReason: opts?.reason ?? null,
    };
    set({
      activeSession: null,
      recoveryPromptPending: false,
      completedSessions: retainCompletedSessions([completed, ...get().completedSessions]),
    });
    await persist(get());
    void finalizeCompletedWalk(completed.clientId, stepIntervals, get);
    return completed;
  },

  discardActiveWalk: async () => {
    set({ activeSession: null, recoveryPromptPending: false });
    await persist(get());
  },

  recordMovementSample: async (sample) => {
    const session = get().activeSession;
    if (!session || session.status !== 'active') return;

    const nextStepCount = session.usesNativeSteps
      ? session.stepCount
      : session.stepCount + Math.max(0, sample.stepCountDelta ?? 0);
    const point = toPathPoint(sample.location, sample.timestamp, nextStepCount);
    const currentSegment = getCurrentPathSegment(session);
    const lastPoint = currentSegment?.points[currentSegment.points.length - 1];
    const accepted = acceptPathPoint(lastPoint, point, sample);
    const nextPathSegments = accepted
      ? appendPathPoint(session.pathSegments, sample.timestamp, point)
      : session.pathSegments;
    const segmentMeters = accepted && lastPoint ? haversineMeters(lastPoint, point) : 0;
    const movedBySteps = (sample.stepCountDelta ?? 0) > 0;
    const movedBySpeed = typeof sample.speedMps === 'number' && sample.speedMps > 0.3;
    const lastMovementAt = accepted || movedBySteps || movedBySpeed ? sample.timestamp : session.lastMovementAt;

    set({
      activeSession: {
        ...session,
        pathSegments: nextPathSegments,
        distanceMeters: session.distanceMeters + segmentMeters,
        stepCount: nextStepCount,
        lastMovementAt,
      },
      lastKnownLocation: {
        latitude: sample.location.latitude,
        longitude: sample.location.longitude,
      },
    });
    schedulePersist(get);
  },

  setNativeStepCount: async (steps, recordedAt) => {
    const session = get().activeSession;
    if (!session || session.status !== 'active') return;
    const currentNativeIntervalSteps = Math.max(0, Math.round(steps));
    const nativeStepBase = session.nativeStepBase ?? 0;
    const nextStepCount = Math.max(session.stepCount, nativeStepBase + currentNativeIntervalSteps);
    const didMove = nextStepCount > session.stepCount;
    set({
      activeSession: {
        ...session,
        stepCount: nextStepCount,
        currentNativeIntervalSteps,
        lastMovementAt: didMove ? (recordedAt ?? new Date().toISOString()) : session.lastMovementAt,
        usesNativeSteps: true,
      },
    });
    schedulePersist(get);
  },

  markAutoPromptShown: async () => {
    const session = get().activeSession;
    if (!session || session.status !== 'active') return;
    set({ activeSession: { ...session, lastAutoPromptAt: new Date().toISOString() } });
    await persist(get());
  },

  continueAfterAutoPrompt: async () => {
    const session = get().activeSession;
    if (!session || session.status !== 'active') return;
    set({
      activeSession: {
        ...session,
        lastMovementAt: new Date().toISOString(),
        lastAutoPromptAt: undefined,
      },
    });
    await persist(get());
  },

  markCollected: async (entityId, smellMeta) => {
    const session = get().activeSession;
    if (!session || session.collectedEntityIds.includes(entityId)) return;
    set({
      activeSession: {
        ...session,
        collectedEntityIds: [...session.collectedEntityIds, entityId],
        collectedSmells: smellMeta
          ? [...session.collectedSmells, smellMeta]
          : session.collectedSmells,
      },
    });
    await persist(get());
  },

  syncPendingWalks: async () => {
    const sessions = get().completedSessions;
    for (const session of sessions) {
      if (session.syncState !== 'pending' && session.syncState !== 'failed') continue;
      set({
        completedSessions: get().completedSessions.map((candidate) =>
          candidate.clientId === session.clientId
            ? { ...candidate, syncState: 'syncing', syncError: undefined }
            : candidate,
        ),
      });
      await persist(get());
      try {
        const synced = await syncWalk(toSyncRequest(session));
        set({
          completedSessions: get().completedSessions.map((candidate) =>
            candidate.clientId === session.clientId
              ? { ...candidate, serverId: synced.id, syncState: 'synced', syncError: undefined }
              : candidate,
          ),
        });
      } catch (err) {
        set({
          completedSessions: get().completedSessions.map((candidate) =>
            candidate.clientId === session.clientId
              ? { ...candidate, syncState: 'failed', syncError: describeSyncError(err) }
              : candidate,
          ),
        });
      }
      await persist(get());
    }
  },
}));

function toPathPoint(location: Location, recordedAt: string, stepCountTotal: number): WalkPathPoint {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    altitude: location.altitude,
    recordedAt,
    stepCountTotal,
    source: 'gps',
  };
}

function closeActiveStepInterval(session: LocalWalkSession, endedAt: string): WalkStepInterval[] {
  const startedAt = session.currentStepIntervalStartedAt;
  if (!startedAt || Date.parse(endedAt) <= Date.parse(startedAt)) return session.activeStepIntervals;
  return [...session.activeStepIntervals, { startedAt, endedAt }];
}

function closeActivePathSegment(
  segments: LocalWalkPathSegment[],
  endedAt: string,
): LocalWalkPathSegment[] {
  const last = segments[segments.length - 1];
  if (!last || last.endedAt) return segments;
  return segments.map((segment, index) =>
    index === segments.length - 1 ? { ...segment, endedAt } : segment,
  );
}

function getCurrentPathSegment(session: LocalWalkSession): LocalWalkPathSegment | null {
  return session.pathSegments[session.pathSegments.length - 1] ?? null;
}

function appendPathPoint(
  segments: LocalWalkPathSegment[],
  startedAt: string,
  point: WalkPathPoint,
): LocalWalkPathSegment[] {
  const last = segments[segments.length - 1];
  if (!last || last.endedAt) {
    return [...segments, { startedAt, points: [point] }];
  }
  return segments.map((segment, index) =>
    index === segments.length - 1 ? { ...segment, points: [...segment.points, point] } : segment,
  );
}

async function finalizeCompletedWalk(
  clientId: string,
  stepIntervals: WalkStepInterval[],
  get: () => WalkSessionState,
): Promise<void> {
  const nativeSteps = await sumNativeSteps(stepIntervals);
  if (nativeSteps !== null) {
    useWalkSessionStore.setState({
      completedSessions: get().completedSessions.map((session) =>
        session.clientId === clientId ? { ...session, stepCount: nativeSteps, usesNativeSteps: true } : session,
      ),
    });
    await persist(get());
  }
  await get().syncPendingWalks();
}

async function sumNativeSteps(intervals: WalkStepInterval[]): Promise<number | null> {
  if (intervals.length === 0) return null;
  try {
    const values = await Promise.all(
      intervals.map((interval) =>
        withTimeout(
          queryPedometerSteps(interval.startedAt, interval.endedAt),
          PEDOMETER_QUERY_TIMEOUT_MS,
        ),
      ),
    );
    let sawNative = false;
    let total = 0;
    for (const value of values) {
      if (value === null) continue;
      sawNative = true;
      total += value;
    }
    return sawNative ? total : null;
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function acceptPathPoint(
  previous: WalkPathPoint | undefined,
  point: WalkPathPoint,
  sample: MovementSample,
): boolean {
  if (typeof point.accuracy === 'number' && point.accuracy > MAX_ACCURACY_METERS) return false;
  if (!previous) return true;
  const segmentMeters = haversineMeters(previous, point);
  if (segmentMeters < MIN_SEGMENT_METERS) return false;
  const elapsedSeconds = Math.max(1, (Date.parse(point.recordedAt) - Date.parse(previous.recordedAt)) / 1000);
  const impliedSpeed = segmentMeters / elapsedSeconds;
  if (impliedSpeed > IMPOSSIBLE_SPEED_MPS) return false;
  if (typeof sample.speedMps === 'number' && sample.speedMps > IMPOSSIBLE_SPEED_MPS) return false;
  return true;
}

function toSyncRequest(session: LocalWalkSession): SyncWalkRequest {
  const endedAt = session.endedAt ?? new Date().toISOString();
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000));
  const closedPauses = getClosedPauseIntervals(session.pauseIntervals, endedAt);
  const pausedDurationSeconds = getPausedDurationSeconds(session.pauseIntervals, endedAt);
  return {
    clientId: session.clientId,
    status:
      session.status === 'auto_completed' || session.status === 'recovered_after_termination'
        ? session.status
        : 'completed',
    startedAt: session.startedAt,
    endedAt,
    durationSeconds,
    movingDurationSeconds: Math.max(0, durationSeconds - pausedDurationSeconds),
    pausedDurationSeconds,
    distanceMeters: Math.round(session.distanceMeters * 100) / 100,
    stepCount: session.stepCount,
    collectedCount: session.collectedEntityIds.length,
    autoFinished: !!session.autoFinished,
    autoFinishReason: session.autoFinishReason ?? null,
    pathSegments: toClosedPathSegments(session.pathSegments, endedAt),
    pauseIntervals: closedPauses,
  };
}

function toClosedPathSegments(
  segments: LocalWalkPathSegment[],
  fallbackEndedAt: string,
): WalkPathSegment[] {
  return segments
    .filter((segment) => segment.points.length > 0)
    .map((segment) => ({
      startedAt: segment.startedAt,
      endedAt: segment.endedAt ?? fallbackEndedAt,
      points: segment.points,
    }));
}

async function persist(state: PersistedState): Promise<void> {
  lastPersistAt = Date.now();
  const payload: PersistedState = {
    ownerId: state.ownerId,
    activeSession: state.activeSession,
    completedSessions: state.completedSessions,
    lastKnownLocation: state.lastKnownLocation,
  };
  await AsyncStorage.setItem(storageKeyForOwner(state.ownerId), JSON.stringify(payload));
}

function schedulePersist(get: () => PersistedState): void {
  const elapsed = Date.now() - lastPersistAt;
  if (elapsed >= PERSIST_INTERVAL_MS) {
    if (pendingPersist) {
      clearTimeout(pendingPersist);
      pendingPersist = null;
    }
    void persist(get());
    return;
  }
  if (pendingPersist) return;
  pendingPersist = setTimeout(() => {
    pendingPersist = null;
    void persist(get());
  }, PERSIST_INTERVAL_MS - elapsed);
}

function clearPendingPersist(): void {
  if (pendingPersist) {
    clearTimeout(pendingPersist);
    pendingPersist = null;
  }
}

function storageKeyForOwner(ownerId: string | null): string {
  return ownerId ? `${STORAGE_KEY_PREFIX}.${ownerId}` : `${STORAGE_KEY_PREFIX}.anonymous`;
}

async function removePreviousWalkStorage(ownerId: string | null): Promise<void> {
  const oldKeys = [
    LEGACY_STORAGE_KEY,
    `${PREVIOUS_STORAGE_KEY_PREFIX}.anonymous`,
    `${PREVIOUS_STORAGE_KEY_PREFIX}.authenticated`,
    `${STORAGE_KEY_PREFIX}.authenticated`,
  ];
  if (ownerId) oldKeys.push(`${PREVIOUS_STORAGE_KEY_PREFIX}.${ownerId}`);
  await Promise.all(oldKeys.map((key) => AsyncStorage.removeItem(key)));
}

function emptyInMemoryState(
  ownerId: string | null,
  hydrated: boolean,
): Pick<
  WalkSessionState,
  'ownerId' | 'activeSession' | 'completedSessions' | 'hydrated' | 'recoveryPromptPending' | 'lastKnownLocation'
> {
  return {
    ownerId,
    activeSession: null,
    completedSessions: [],
    hydrated,
    recoveryPromptPending: false,
    lastKnownLocation: undefined,
  };
}

export function getClosedPauseIntervals(
  pauses: WalkPauseInterval[],
  fallbackEndedAt: string,
): WalkStepInterval[] {
  return pauses.flatMap((interval) => {
    const endedAt = interval.endedAt ?? fallbackEndedAt;
    return Date.parse(endedAt) > Date.parse(interval.startedAt)
      ? [{ startedAt: interval.startedAt, endedAt }]
      : [];
  });
}

export function getPausedDurationSeconds(pauses: WalkPauseInterval[], fallbackEndedAt: string): number {
  return getClosedPauseIntervals(pauses, fallbackEndedAt).reduce(
    (sum, interval) =>
      sum + Math.max(0, Math.round((Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 1000)),
    0,
  );
}

export function getMovingDurationSeconds(session: LocalWalkSession, nowIso: string): number {
  const endedAt = session.endedAt ?? nowIso;
  const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000));
  return Math.max(0, durationSeconds - getPausedDurationSeconds(session.pauseIntervals, endedAt));
}

function retainCompletedSessions(sessions: LocalWalkSession[]): LocalWalkSession[] {
  const unsynced = sessions.filter((session) => session.syncState !== 'synced');
  const synced = sessions
    .filter((session) => session.syncState === 'synced')
    .slice(0, Math.max(0, MAX_SYNCED_HISTORY - unsynced.length));
  return [...unsynced, ...synced];
}

function normalizeLocalSession(session: LocalWalkSession): LocalWalkSession {
  return {
    ...session,
    pathSegments: session.pathSegments ?? [],
    activeStepIntervals: session.activeStepIntervals ?? [],
    currentStepIntervalStartedAt:
      session.currentStepIntervalStartedAt ??
      (session.status === 'active' ? session.startedAt : undefined),
    nativeStepBase: session.nativeStepBase ?? 0,
    currentNativeIntervalSteps: session.currentNativeIntervalSteps ?? 0,
    collectedSmells: session.collectedSmells ?? [],
  };
}

function createUuid(): string {
  const cryptoApi = (globalThis as unknown as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    };
  }).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function describeSyncError(err: unknown): string {
  return describeApiError(err);
}

export function __resetWalkSessionStoreForTests(): void {
  clearPendingPersist();
  lastPersistAt = 0;
  useWalkSessionStore.setState({
    ownerId: null,
    activeSession: null,
    completedSessions: [],
    hydrated: false,
    recoveryPromptPending: false,
    lastKnownLocation: undefined,
  });
}
