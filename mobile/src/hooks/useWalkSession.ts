import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';

import type { MovementDetectionResult } from '@/hooks/useMovementDetection';
import { startPedometerUpdates } from '@/native/Pedometer';
import { useAuthStore } from '@/stores/authStore';
import { useWalkSessionStore } from '@/stores/walkSessionStore';

const PROMPT_AFTER_MS = 3 * 60 * 1000;
const AUTO_FINISH_AFTER_MS = 6 * 60 * 1000;
const CHECK_INTERVAL_MS = 15_000;

export function useWalkSession(movement: MovementDetectionResult): void {
  const lastRecordedSampleAtRef = useRef<string | null>(null);
  const ownerId = useAuthStore((s) => s.user?.id ?? (s.isAuthenticated ? 'authenticated' : null));
  const hydrate = useWalkSessionStore((s) => s.hydrate);
  const hydrated = useWalkSessionStore((s) => s.hydrated);
  const activeSession = useWalkSessionStore((s) => s.activeSession);
  const activeSessionClientId = activeSession?.clientId;
  const activeSessionStatus = activeSession?.status;
  const recordMovementSample = useWalkSessionStore((s) => s.recordMovementSample);
  const setNativeStepCount = useWalkSessionStore((s) => s.setNativeStepCount);
  const endWalk = useWalkSessionStore((s) => s.endWalk);
  const markAutoPromptShown = useWalkSessionStore((s) => s.markAutoPromptShown);
  const continueAfterAutoPrompt = useWalkSessionStore((s) => s.continueAfterAutoPrompt);
  const syncPendingWalks = useWalkSessionStore((s) => s.syncPendingWalks);

  useEffect(() => {
    void hydrate(ownerId);
  }, [hydrate, ownerId]);

  useEffect(() => {
    if (!movement.latest || !activeSessionClientId || activeSessionStatus !== 'active') return;
    if (lastRecordedSampleAtRef.current === movement.latest.timestamp) return;
    lastRecordedSampleAtRef.current = movement.latest.timestamp;
    void recordMovementSample(movement.latest);
  }, [activeSessionClientId, activeSessionStatus, movement.latest, recordMovementSample]);

  useEffect(() => {
    if (!activeSession || activeSession.status !== 'active') return undefined;
    const startedAt = activeSession.currentStepIntervalStartedAt ?? activeSession.startedAt;
    const stop = startPedometerUpdates(startedAt, (update) => {
      void setNativeStepCount(update.steps, update.endDate);
    });
    return stop;
  }, [
    activeSession?.clientId,
    activeSession?.currentStepIntervalStartedAt,
    activeSession?.startedAt,
    activeSession?.status,
    setNativeStepCount,
  ]);

  useEffect(() => {
    if (!hydrated) return undefined;
    void syncPendingWalks();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncPendingWalks();
    });
    return () => sub.remove();
  }, [hydrated, syncPendingWalks]);

  useEffect(() => {
    const interval = setInterval(() => {
      const session = useWalkSessionStore.getState().activeSession;
      if (!session || session.status !== 'active') return;
      const inactiveMs = Date.now() - Date.parse(session.lastMovementAt);
      if (inactiveMs >= AUTO_FINISH_AFTER_MS) {
        void endWalk({ auto: true, reason: 'stationary_timeout', endedAt: session.lastMovementAt });
        return;
      }
      const promptedRecently =
        session.lastAutoPromptAt &&
        Date.now() - Date.parse(session.lastAutoPromptAt) < PROMPT_AFTER_MS;
      if (inactiveMs >= PROMPT_AFTER_MS && !promptedRecently) {
        void markAutoPromptShown();
        Alert.alert('Still walking?', 'ParkWalk has not seen movement for a few minutes.', [
          {
            text: 'End Walk',
            style: 'destructive',
            onPress: () =>
              void endWalk({ auto: true, reason: 'stationary_prompt', endedAt: session.lastMovementAt }),
          },
          {
            text: 'Resume',
            onPress: () => void continueAfterAutoPrompt(),
          },
        ]);
      }
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [continueAfterAutoPrompt, endWalk, markAutoPromptShown]);
}
