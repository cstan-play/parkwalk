import type { SyncWalkRequest } from '@parkwalk/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetWalkSessionStoreForTests,
  getMovingDurationSeconds,
  getPausedDurationSeconds,
  useWalkSessionStore,
  type LocalWalkSession,
} from './walkSessionStore';

import { queryPedometerSteps } from '@/native/Pedometer';
import { syncWalk } from '@/services/walksApi';

jest.mock('@/native/Pedometer', () => ({
  queryPedometerSteps: jest.fn(async () => null),
}));

jest.mock('@/services/walksApi', () => ({
  syncWalk: jest.fn(async (request: SyncWalkRequest) => ({
    ...request,
    id: '11111111-1111-4111-8111-111111111111',
    pathPointCount: request.pathSegments.reduce((sum, segment) => sum + segment.points.length, 0),
    createdAt: request.endedAt,
    updatedAt: request.endedAt,
  })),
}));

const mockedQueryPedometerSteps = queryPedometerSteps as jest.MockedFunction<
  typeof queryPedometerSteps
>;
const mockedSyncWalk = syncWalk as jest.MockedFunction<typeof syncWalk>;

const baseLocation = { latitude: 55.6761, longitude: 12.5683, accuracy: 5 };

function setNow(iso: string): void {
  jest.setSystemTime(new Date(iso));
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('walkSessionStore stabilization behavior', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    setNow('2026-04-29T10:00:00.000Z');
    await AsyncStorage.clear();
    __resetWalkSessionStoreForTests();
    jest.clearAllMocks();
    mockedQueryPedometerSteps.mockResolvedValue(null);
    mockedSyncWalk.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      clientId: '22222222-2222-4222-8222-222222222222',
      status: 'completed',
      startedAt: '2026-04-29T10:00:00.000Z',
      endedAt: '2026-04-29T10:01:00.000Z',
      durationSeconds: 60,
      movingDurationSeconds: 60,
      pausedDurationSeconds: 0,
      distanceMeters: 10,
      stepCount: 10,
      collectedCount: 0,
      autoFinished: false,
      autoFinishReason: null,
      pathPointCount: 0,
      pathSegments: [],
      pauseIntervals: [],
      weatherSnapshot: null,
      smells: { totalCount: 0, byType: {} },
      createdAt: '2026-04-29T10:01:00.000Z',
      updatedAt: '2026-04-29T10:01:00.000Z',
    });
  });

  afterEach(() => {
    __resetWalkSessionStoreForTests();
    jest.useRealTimers();
  });

  it('updates lastMovementAt when native steps increase', async () => {
    await useWalkSessionStore.getState().startWalk(baseLocation);

    await useWalkSessionStore
      .getState()
      .setNativeStepCount(7, '2026-04-29T10:00:12.000Z');

    const active = useWalkSessionStore.getState().activeSession;
    expect(active?.stepCount).toBe(7);
    expect(active?.usesNativeSteps).toBe(true);
    expect(active?.lastMovementAt).toBe('2026-04-29T10:00:12.000Z');
  });

  it('ignores live native step updates while paused', async () => {
    await useWalkSessionStore.getState().startWalk(baseLocation);
    await useWalkSessionStore
      .getState()
      .setNativeStepCount(5, '2026-04-29T10:00:05.000Z');
    await useWalkSessionStore.getState().pauseWalk();

    await useWalkSessionStore
      .getState()
      .setNativeStepCount(99, '2026-04-29T10:01:00.000Z');

    expect(useWalkSessionStore.getState().activeSession?.stepCount).toBe(5);
  });

  it('persists auto-finish prompt state through store actions', async () => {
    await useWalkSessionStore.getState().startWalk(baseLocation);
    (AsyncStorage.setItem as jest.Mock).mockClear();

    setNow('2026-04-29T10:03:00.000Z');
    await useWalkSessionStore.getState().markAutoPromptShown();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
    expect(persisted.activeSession.lastAutoPromptAt).toBe('2026-04-29T10:03:00.000Z');

    setNow('2026-04-29T10:03:15.000Z');
    await useWalkSessionStore.getState().continueAfterAutoPrompt();

    expect(useWalkSessionStore.getState().activeSession?.lastAutoPromptAt).toBeUndefined();
    expect(useWalkSessionStore.getState().activeSession?.lastMovementAt).toBe(
      '2026-04-29T10:03:15.000Z',
    );
  });

  it('scopes new persisted walks by owner and drops previous alpha storage', async () => {
    await AsyncStorage.setItem(
      'parkwalk.walk_sessions.v1',
      JSON.stringify({
        ownerId: null,
        activeSession: activeSession({ clientId: 'legacy-walk' }),
        completedSessions: [],
      }),
    );
    await AsyncStorage.setItem(
      'parkwalk.walk_sessions.v2.user-a',
      JSON.stringify({
        ownerId: 'user-a',
        activeSession: activeSession({ clientId: 'user-a-walk' }),
        completedSessions: [],
      }),
    );
    await AsyncStorage.setItem(
      'parkwalk.walk_sessions.v3.user-a',
      JSON.stringify({
        ownerId: 'user-a',
        activeSession: activeSession({ clientId: 'fresh-user-a-walk' }),
        completedSessions: [],
      }),
    );
    await AsyncStorage.setItem(
      'parkwalk.walk_sessions.v3.authenticated',
      JSON.stringify({
        ownerId: 'authenticated',
        activeSession: activeSession({ clientId: 'shared-authenticated-walk' }),
        completedSessions: [],
      }),
    );

    await useWalkSessionStore.getState().hydrate('user-b');

    expect(useWalkSessionStore.getState().activeSession).toBeNull();
    expect(useWalkSessionStore.getState().recoveryPromptPending).toBe(false);
    expect(await AsyncStorage.getItem('parkwalk.walk_sessions.v1')).toBeNull();
    expect(await AsyncStorage.getItem('parkwalk.walk_sessions.v3.authenticated')).toBeNull();

    await useWalkSessionStore.getState().hydrate('user-a');

    expect(useWalkSessionStore.getState().activeSession?.clientId).toBe('fresh-user-a-walk');
    expect(useWalkSessionStore.getState().recoveryPromptPending).toBe(true);
    expect(await AsyncStorage.getItem('parkwalk.walk_sessions.v2.user-a')).toBeNull();
  });

  it('normalizes corrupt completed walk rows during hydrate', async () => {
    await AsyncStorage.setItem(
      'parkwalk.walk_sessions.v3.user-a',
      JSON.stringify({
        ownerId: 'user-a',
        activeSession: null,
        completedSessions: [
          {
            clientId: 'corrupt-walk',
            status: 'completed',
            startedAt: '2026-04-29T09:00:00.000Z',
            pathSegments: [
              {
                startedAt: '2026-04-29T09:00:00.000Z',
                points: [
                  { latitude: 55.6761, longitude: 12.5683, recordedAt: '2026-04-29T09:00:00.000Z' },
                  { latitude: 'bad', longitude: 12.5684, recordedAt: '2026-04-29T09:01:00.000Z' },
                ],
              },
            ],
            collectedEntityIds: [123, 'entity-a'],
            collectedSmells: [
              { entityId: 'entity-a', smellType: 'pigeons', collectedAt: '2026-04-29T09:01:00.000Z' },
              { entityId: 'entity-b', smellType: 'unknown' },
            ],
          },
          null,
        ],
      }),
    );

    await useWalkSessionStore.getState().hydrate('user-a');

    const [walk] = useWalkSessionStore.getState().completedSessions;
    expect(useWalkSessionStore.getState().completedSessions).toHaveLength(1);
    expect(walk?.clientId).toBe('corrupt-walk');
    expect(walk?.distanceMeters).toBe(0);
    expect(walk?.stepCount).toBe(0);
    expect(walk?.syncState).toBe('synced');
    expect(walk?.pathSegments[0]?.points).toHaveLength(1);
    expect(walk?.collectedEntityIds).toEqual(['entity-a']);
    expect(walk?.collectedSmells).toEqual([
      {
        entityId: 'entity-a',
        smellType: 'pigeons',
        name: 'Unknown smell',
        points: 0,
        collectedAt: '2026-04-29T09:01:00.000Z',
        gusFlavor: undefined,
      },
    ]);
  });

  it('does not persist on every native step update', async () => {
    await useWalkSessionStore.getState().startWalk(baseLocation);
    (AsyncStorage.setItem as jest.Mock).mockClear();

    await useWalkSessionStore
      .getState()
      .setNativeStepCount(1, '2026-04-29T10:00:01.000Z');
    await useWalkSessionStore
      .getState()
      .setNativeStepCount(2, '2026-04-29T10:00:02.000Z');
    await useWalkSessionStore
      .getState()
      .setNativeStepCount(3, '2026-04-29T10:00:03.000Z');

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10_000);
    await flushPromises();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('excludes paused windows from final native step backfill', async () => {
    mockedQueryPedometerSteps
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(200);

    await useWalkSessionStore.getState().startWalk(baseLocation);
    setNow('2026-04-29T10:01:00.000Z');
    await useWalkSessionStore.getState().pauseWalk();
    setNow('2026-04-29T10:03:00.000Z');
    await useWalkSessionStore.getState().resumeWalk();
    setNow('2026-04-29T10:04:00.000Z');
    await useWalkSessionStore.getState().endWalk();

    await flushPromises();

    expect(mockedQueryPedometerSteps).toHaveBeenNthCalledWith(
      1,
      '2026-04-29T10:00:00.000Z',
      '2026-04-29T10:01:00.000Z',
    );
    expect(mockedQueryPedometerSteps).toHaveBeenNthCalledWith(
      2,
      '2026-04-29T10:03:00.000Z',
      '2026-04-29T10:04:00.000Z',
    );
    expect(useWalkSessionStore.getState().completedSessions[0]?.stepCount).toBe(300);
    expect(mockedSyncWalk).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 240,
        movingDurationSeconds: 120,
        pausedDurationSeconds: 120,
      }),
    );
  });

  it('stores pause and resume paths as separate route segments', async () => {
    await useWalkSessionStore.getState().startWalk(baseLocation);
    await useWalkSessionStore.getState().recordMovementSample({
      timestamp: '2026-04-29T10:00:10.000Z',
      location: { latitude: 55.6762, longitude: 12.5683, accuracy: 5 },
      speedMps: 1.2,
      stepCountDelta: 10,
    });

    setNow('2026-04-29T10:01:00.000Z');
    await useWalkSessionStore.getState().pauseWalk();

    setNow('2026-04-29T10:03:00.000Z');
    await useWalkSessionStore.getState().resumeWalk({
      latitude: 55.677,
      longitude: 12.569,
      accuracy: 5,
    });
    await useWalkSessionStore.getState().recordMovementSample({
      timestamp: '2026-04-29T10:03:10.000Z',
      location: { latitude: 55.6771, longitude: 12.569, accuracy: 5 },
      speedMps: 1.2,
      stepCountDelta: 10,
    });

    const active = useWalkSessionStore.getState().activeSession;
    expect(active?.pathSegments).toHaveLength(2);
    expect(active?.pathSegments[0]?.endedAt).toBe('2026-04-29T10:01:00.000Z');
    expect(active?.pathSegments[0]?.points).toHaveLength(2);
    expect(active?.pathSegments[1]?.startedAt).toBe('2026-04-29T10:03:00.000Z');
    expect(active?.pathSegments[1]?.points).toHaveLength(2);

    setNow('2026-04-29T10:04:00.000Z');
    await useWalkSessionStore.getState().endWalk();
    await flushPromises();

    expect(mockedSyncWalk).toHaveBeenCalledWith(
      expect.objectContaining({
        pathSegments: [
          expect.objectContaining({
            startedAt: '2026-04-29T10:00:00.000Z',
            endedAt: '2026-04-29T10:01:00.000Z',
            points: expect.arrayContaining([
              expect.objectContaining({ latitude: 55.6761 }),
              expect.objectContaining({ latitude: 55.6762 }),
            ]),
          }),
          expect.objectContaining({
            startedAt: '2026-04-29T10:03:00.000Z',
            endedAt: '2026-04-29T10:04:00.000Z',
            points: expect.arrayContaining([
              expect.objectContaining({ latitude: 55.677 }),
              expect.objectContaining({ latitude: 55.6771 }),
            ]),
          }),
        ],
      }),
    );
  });

  it('keeps moving time paused while active pause interval is open', () => {
    const session = activeSession({
      startedAt: '2026-04-29T10:00:00.000Z',
      pauseIntervals: [{ startedAt: '2026-04-29T10:01:00.000Z' }],
    });

    expect(getMovingDurationSeconds(session, '2026-04-29T10:03:00.000Z')).toBe(60);
    expect(getPausedDurationSeconds(session.pauseIntervals, '2026-04-29T10:03:00.000Z')).toBe(120);
  });

  it('clears the active walk before final pedometer query and sync complete', async () => {
    let resolveSteps: (value: number | null) => void = () => undefined;
    mockedQueryPedometerSteps.mockImplementation(
      () => new Promise((resolve) => {
        resolveSteps = resolve;
      }),
    );

    await useWalkSessionStore.getState().startWalk(baseLocation);
    setNow('2026-04-29T10:02:00.000Z');

    const endPromise = useWalkSessionStore.getState().endWalk();

    await endPromise;

    expect(useWalkSessionStore.getState().activeSession).toBeNull();
    expect(useWalkSessionStore.getState().completedSessions).toHaveLength(1);

    resolveSteps(42);
    await flushPromises();

    expect(useWalkSessionStore.getState().completedSessions[0]?.stepCount).toBe(42);
  });

  it('keeps unsynced walks when trimming completed history', async () => {
    const synced: LocalWalkSession[] = Array.from({ length: 100 }, (_, index) =>
      completedSession({
        clientId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
        syncState: 'synced',
      }),
    );
    useWalkSessionStore.setState({ completedSessions: synced });

    await useWalkSessionStore.getState().startWalk(baseLocation);
    await useWalkSessionStore.getState().endWalk();

    const sessions = useWalkSessionStore.getState().completedSessions;
    expect(sessions.some((session) => session.syncState !== 'synced')).toBe(true);
    expect(sessions).toHaveLength(100);
  });
});

function activeSession(overrides: Partial<LocalWalkSession>): LocalWalkSession {
  return {
    ...completedSession({
      status: 'active',
      endedAt: undefined,
      currentStepIntervalStartedAt: '2026-04-29T09:00:00.000Z',
      syncState: 'pending',
    }),
    ...overrides,
  };
}

function completedSession(overrides: Partial<LocalWalkSession>): LocalWalkSession {
  return {
    clientId: '33333333-3333-4333-8333-333333333333',
    status: 'completed',
    startedAt: '2026-04-29T09:00:00.000Z',
    endedAt: '2026-04-29T09:10:00.000Z',
    pauseIntervals: [],
    activeStepIntervals: [],
    pathSegments: [],
    distanceMeters: 0,
    stepCount: 0,
    collectedEntityIds: [],
    collectedSmells: [],
    lastMovementAt: '2026-04-29T09:10:00.000Z',
    syncState: 'synced',
    ...overrides,
  };
}
