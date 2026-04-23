import {
  GPS_MIN_DISPLACEMENT_M,
  GPS_UPDATE_INTERVAL_MS,
  type MovementSample,
} from '@parkwalk/shared';
import Geolocation, { type GeoPosition } from 'react-native-geolocation-service';
import { Platform } from 'react-native';
import { accelerometer, SensorTypes, setUpdateIntervalForType } from 'react-native-sensors';

import { pickBestFix } from './pickBestFix';
import { createStepDetector } from './stepDetector';

export interface SensorSource {
  subscribe: (onSample: (sample: MovementSample) => void) => () => void;
}

const ACCEL_UPDATE_INTERVAL_MS = 33; // ~30 Hz — needed to catch walking peaks
const EMIT_INTERVAL_MS = 1000; // fixed-rate MovementSample cadence

// Short-term fix buffer used by the "best recent fix" smoother (see
// `pickBestFix`). We keep the last ~5 GPS fixes (roughly the last 5 seconds
// at 1 Hz) and, when emitting a MovementSample, prefer the fix with the
// lowest `horizontalAccuracy` inside the freshness window. This masks the
// single-spike ~50 m drift that happens when iOS briefly loses satellites
// behind a building and falls back to Wi-Fi positioning — without hiding
// persistent drift (once every fix in the window is ±40 m, the smoother
// has nothing better to return).
const FIX_BUFFER_SIZE = 5;

/**
 * Production sensor source.
 *
 * Three streams feed a 1 Hz emit loop:
 *   - Accelerometer at ~30 Hz, fed to a peak-detection pedometer.
 *   - GPS watchPosition() whenever iOS gives us a fix.
 *   - A fixed 1 Hz timer that assembles the latest GPS fix + step delta into
 *     a MovementSample and pushes to `onSample`.
 *
 * Decoupling emission from GPS fix-rate matters: when you're stationary, iOS
 * throttles GPS to every ~5-30s, which would otherwise starve the movement
 * classifier of step data. Stepping into the pedometer at 30 Hz means a user
 * can be sitting still with valid steps accumulating (e.g. running in place),
 * or walking out of a stationary spot without losing the first 15 seconds.
 *
 * Activity recognition (CMMotionActivity) is still stubbed — see Alpha
 * follow-up #3 in docs/13-BOOTSTRAP-IOS.md. Until that lands, `activity`
 * is always `'UNKNOWN'` and the classifier uses speed + step rate only.
 */
export function createProductionSensorSource(): SensorSource {
  return {
    subscribe(onSample) {
      setUpdateIntervalForType(SensorTypes.accelerometer, ACCEL_UPDATE_INTERVAL_MS);

      const detector = createStepDetector();
      let latestAcceleration: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
      const fixBuffer: { pos: GeoPosition; receivedAt: number }[] = [];
      let stepsSinceLastEmit = 0;

      const accelSub = accelerometer.subscribe((value) => {
        latestAcceleration = { x: value.x, y: value.y, z: value.z };
        if (detector.update(value.x, value.y, value.z, Date.now())) {
          stepsSinceLastEmit += 1;
        }
      });

      const watchId = Geolocation.watchPosition(
        (pos) => {
          fixBuffer.push({ pos, receivedAt: Date.now() });
          if (fixBuffer.length > FIX_BUFFER_SIZE) fixBuffer.shift();
        },
        (err) => {
          console.warn('geolocation error', err);
        },
        {
          enableHighAccuracy: true,
          accuracy: { ios: 'bestForNavigation' },
          distanceFilter: GPS_MIN_DISPLACEMENT_M,
          interval: GPS_UPDATE_INTERVAL_MS,
          fastestInterval: GPS_UPDATE_INTERVAL_MS,
          showLocationDialog: true,
          forceRequestLocation: true,
          showsBackgroundLocationIndicator: Platform.OS === 'ios',
          // iOS-only. The underlying Swift reads this key from the options
          // dict even though @types/react-native-geolocation-service omits it.
          // Default is `true`, which causes iOS to pause updates when it
          // decides the user is stationary; on resume GPS cold-starts with
          // ~50 m accuracy for several seconds. Keeping updates alive avoids
          // that drift on short pauses during a walk.
          pauseUpdatesAutomatically: false,
        } as Parameters<typeof Geolocation.watchPosition>[2],
      );

      const emitTimer = setInterval(() => {
        const pos = pickBestFix(fixBuffer, Date.now());
        if (!pos) return; // wait for first fix
        const sample: MovementSample = {
          timestamp: new Date().toISOString(),
          location: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            altitude: pos.coords.altitude ?? undefined,
          },
          speedMps:
            typeof pos.coords.speed === 'number' && pos.coords.speed >= 0
              ? pos.coords.speed
              : null,
          headingDegrees:
            typeof pos.coords.heading === 'number' && pos.coords.heading >= 0
              ? pos.coords.heading
              : undefined,
          acceleration: { ...latestAcceleration },
          stepCountDelta: stepsSinceLastEmit,
          activity: 'UNKNOWN',
        };
        stepsSinceLastEmit = 0;
        onSample(sample);
      }, EMIT_INTERVAL_MS);

      return () => {
        clearInterval(emitTimer);
        Geolocation.clearWatch(watchId);
        accelSub.unsubscribe();
      };
    },
  };
}
