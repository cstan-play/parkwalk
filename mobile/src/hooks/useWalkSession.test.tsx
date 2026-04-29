import React from 'react';
import { act, create } from 'react-test-renderer';

import type { MovementDetectionResult } from '@/hooks/useMovementDetection';
import { useWalkSession } from '@/hooks/useWalkSession';
import { startPedometerUpdates } from '@/native/Pedometer';
import { useAuthStore } from '@/stores/authStore';
import {
  __resetWalkSessionStoreForTests,
  useWalkSessionStore,
  type LocalWalkSession,
} from '@/stores/walkSessionStore';

jest.mock('@/native/Pedometer', () => ({
  startPedometerUpdates: jest.fn(() => jest.fn()),
}));

const mockedStartPedometerUpdates = startPedometerUpdates as jest.MockedFunction<
  typeof startPedometerUpdates
>;

const movement: MovementDetectionResult = {
  state: 'STATIONARY',
  latest: {
    timestamp: '2026-04-29T10:00:01.000Z',
    location: { latitude: 55.6761, longitude: 12.5683, accuracy: 5 },
    speedMps: 0,
    acceleration: { x: 0, y: 0, z: 1 },
    stepCountDelta: 0,
    activity: 'STILL',
  },
  samples: [],
  summary: {
    windowSeconds: 10,
    sampleCount: 1,
    state: 'STATIONARY',
    averageSpeedMps: 0,
    maxSpeedMps: 0,
    stepRateHz: 0,
    averageAccuracyMeters: 5,
    dominantActivity: 'STILL',
    validationScore: 0,
    generatedAt: '2026-04-29T10:00:01.000Z',
  },
};

function TestHarness({ value }: { value: MovementDetectionResult }): null {
  useWalkSession(value);
  return null;
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('useWalkSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedStartPedometerUpdates.mockClear();
    __resetWalkSessionStoreForTests();
    useAuthStore.setState({
      user: null,
      tokens: null,
      isAuthenticated: false,
    });
  });

  afterEach(() => {
    __resetWalkSessionStoreForTests();
    jest.useRealTimers();
  });

  it('does not re-record the same movement sample when active walk state changes', async () => {
    const activeSession = activeWalkSession();
    const recordMovementSample = jest.fn(async () => {
      const current = useWalkSessionStore.getState().activeSession;
      if (!current) return;
      useWalkSessionStore.setState({
        activeSession: {
          ...current,
          distanceMeters: current.distanceMeters + 1,
        },
      });
    });

    useWalkSessionStore.setState({
      ownerId: null,
      hydrated: true,
      activeSession,
      recordMovementSample,
      syncPendingWalks: jest.fn(async () => undefined),
    });

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(<TestHarness value={movement} />);
      await flushPromises();
    });

    await act(async () => {
      await flushPromises();
    });

    expect(recordMovementSample).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer?.update(<TestHarness value={{ ...movement }} />);
      await flushPromises();
    });

    expect(recordMovementSample).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer?.unmount();
    });
  });
});

function activeWalkSession(): LocalWalkSession {
  return {
    clientId: '33333333-3333-4333-8333-333333333333',
    status: 'active',
    startedAt: '2026-04-29T10:00:00.000Z',
    pauseIntervals: [],
    activeStepIntervals: [],
    currentStepIntervalStartedAt: '2026-04-29T10:00:00.000Z',
    path: [],
    distanceMeters: 0,
    stepCount: 0,
    collectedEntityIds: [],
    lastMovementAt: '2026-04-29T10:00:00.000Z',
    syncState: 'pending',
  };
}
