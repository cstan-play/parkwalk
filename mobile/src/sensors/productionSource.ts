import {
  GPS_MIN_DISPLACEMENT_M,
  GPS_UPDATE_INTERVAL_MS,
  type MovementSample,
} from '@parkwalk/shared';
import Geolocation from 'react-native-geolocation-service';
import { Platform } from 'react-native';
import { accelerometer, SensorTypes, setUpdateIntervalForType } from 'react-native-sensors';

export interface SensorSource {
  subscribe: (onSample: (sample: MovementSample) => void) => () => void;
}

/**
 * Production sensor source: real GPS + accelerometer. Step counting is
 * accelerometer-derived (HealthKit step counts are blocked on free Apple
 * provisioning). Activity recognition is stubbed as UNKNOWN and can be
 * wired up to CMMotionActivity via a native module in Phase 2.
 */
export function createProductionSensorSource(): SensorSource {
  return {
    subscribe(onSample) {
      setUpdateIntervalForType(SensorTypes.accelerometer, GPS_UPDATE_INTERVAL_MS);
      let lastAcceleration: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
      const accelSub = accelerometer.subscribe((value) => {
        lastAcceleration = { x: value.x, y: value.y, z: value.z };
      });

      const watchId = Geolocation.watchPosition(
        (pos) => {
          const sample: MovementSample = {
            timestamp: new Date(pos.timestamp).toISOString(),
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
            acceleration: { ...lastAcceleration },
            stepCountDelta: undefined,
            activity: 'UNKNOWN',
          };
          onSample(sample);
        },
        (err) => {
          console.warn('geolocation error', err);
        },
        {
          enableHighAccuracy: true,
          distanceFilter: GPS_MIN_DISPLACEMENT_M,
          interval: GPS_UPDATE_INTERVAL_MS,
          fastestInterval: GPS_UPDATE_INTERVAL_MS,
          showLocationDialog: true,
          forceRequestLocation: true,
          showsBackgroundLocationIndicator: Platform.OS === 'ios',
        },
      );

      return () => {
        Geolocation.clearWatch(watchId);
        accelSub.unsubscribe();
      };
    },
  };
}
