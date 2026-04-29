import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface NativePedometerModule {
  isStepCountingAvailable(): Promise<boolean>;
  getAuthorizationStatus(): Promise<
    'notDetermined' | 'restricted' | 'denied' | 'authorized' | 'unknown'
  >;
  querySteps(
    fromIso: string,
    toIso: string,
  ): Promise<{
    steps: number;
    distanceMeters?: number;
    startDate: string;
    endDate: string;
  }>;
  startUpdates(fromIso: string): void;
  stopUpdates(): void;
}

export interface PedometerUpdate {
  startDate: string;
  endDate: string;
  steps: number;
  distanceMeters?: number;
  currentPaceSecondsPerMeter?: number;
  currentCadenceStepsPerSecond?: number;
}

const nativeModule = NativeModules.ParkWalkPedometer as NativePedometerModule | undefined;
const emitter = nativeModule ? new NativeEventEmitter(NativeModules.ParkWalkPedometer) : null;

export async function isNativePedometerAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !nativeModule) return false;
  return nativeModule.isStepCountingAvailable();
}

export function startPedometerUpdates(
  startedAt: string,
  onUpdate: (update: PedometerUpdate) => void,
): () => void {
  if (Platform.OS !== 'ios' || !nativeModule || !emitter) return () => undefined;
  const sub = emitter.addListener('ParkWalkPedometerUpdate', onUpdate);
  nativeModule.startUpdates(startedAt);
  return () => {
    sub.remove();
    nativeModule.stopUpdates();
  };
}

export async function queryPedometerSteps(
  startedAt: string,
  endedAt: string,
): Promise<number | null> {
  if (Platform.OS !== 'ios' || !nativeModule) return null;
  try {
    const result = await nativeModule.querySteps(startedAt, endedAt);
    return result.steps;
  } catch {
    return null;
  }
}
