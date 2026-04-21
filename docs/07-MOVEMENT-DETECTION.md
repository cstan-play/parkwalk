# Movement Detection Algorithm

## Overview

The movement detection system is the **core differentiator** of this app. It prevents cheating by validating that users are genuinely walking (not driving, biking, or spoofing GPS).

## Detection Strategy

### Multi-Sensor Fusion

The algorithm combines three data sources:

1. **GPS Data** - Speed, accuracy, consistency
2. **Accelerometer** - Gait pattern detection
3. **Activity Recognition** - OS-level classification (iOS Core Motion / Android Activity Recognition)

### Classification States

```typescript
type MovementState = 
  | 'WALKING_VALID'    // Confirmed walking
  | 'VEHICLE'          // Car/bike detected
  | 'STATIONARY'       // Not moving
  | 'SUSPICIOUS'       // Ambiguous data
  | 'UNKNOWN';         // Insufficient data
```

## Algorithm Implementation

### Core Detection Logic

```typescript
interface MovementSample {
  timestamp: number;
  gps: {
    latitude: number;
    longitude: number;
    speed: number;        // m/s
    accuracy: number;     // meters
    heading: number;      // degrees
  };
  accelerometer: {
    x: number;
    y: number;
    z: number;
    magnitude: number;
  };
  activityRecognition?: {
    type: 'WALKING' | 'RUNNING' | 'IN_VEHICLE' | 'ON_BICYCLE' | 'STILL';
    confidence: number;   // 0-1
  };
}

class MovementDetector {
  private readonly MAX_WALKING_SPEED = 2.5;  // m/s (~9 km/h)
  private readonly MIN_WALKING_SPEED = 0.3;  // m/s
  private readonly MIN_GPS_ACCURACY = 20;    // meters
  private readonly WINDOW_SIZE = 10;         // samples
  
  private sampleBuffer: MovementSample[] = [];
  
  classify(sample: MovementSample): {
    state: MovementState;
    confidence: number;
    reason: string;
  } {
    // Add to buffer
    this.sampleBuffer.push(sample);
    if (this.sampleBuffer.length > this.WINDOW_SIZE) {
      this.sampleBuffer.shift();
    }
    
    // Need minimum samples
    if (this.sampleBuffer.length < 3) {
      return {
        state: 'UNKNOWN',
        confidence: 0,
        reason: 'Insufficient data',
      };
    }
    
    // 1. GPS Accuracy Check
    if (sample.gps.accuracy > this.MIN_GPS_ACCURACY) {
      return {
        state: 'SUSPICIOUS',
        confidence: 0.3,
        reason: 'GPS accuracy too low',
      };
    }
    
    // 2. Speed Check (primary filter)
    const avgSpeed = this.calculateAverageSpeed();
    
    if (avgSpeed > this.MAX_WALKING_SPEED) {
      return {
        state: 'VEHICLE',
        confidence: 0.95,
        reason: `Speed ${(avgSpeed * 3.6).toFixed(1)} km/h exceeds walking threshold`,
      };
    }
    
    if (avgSpeed < this.MIN_WALKING_SPEED) {
      return {
        state: 'STATIONARY',
        confidence: 0.8,
        reason: 'Movement too slow',
      };
    }
    
    // 3. Activity Recognition (if available)
    if (sample.activityRecognition) {
      const { type, confidence } = sample.activityRecognition;
      
      if (confidence > 0.7) {
        if (type === 'WALKING' || type === 'RUNNING') {
          // Cross-validate with accelerometer
          const gaitScore = this.analyzeGaitPattern();
          
          if (gaitScore > 0.6) {
            return {
              state: 'WALKING_VALID',
              confidence: Math.min(confidence, gaitScore),
              reason: 'Activity recognition + gait pattern confirmed',
            };
          }
        }
        
        if (type === 'IN_VEHICLE' || type === 'ON_BICYCLE') {
          return {
            state: 'VEHICLE',
            confidence,
            reason: `Activity recognition detected ${type}`,
          };
        }
        
        if (type === 'STILL') {
          return {
            state: 'STATIONARY',
            confidence,
            reason: 'User is stationary',
          };
        }
      }
    }
    
    // 4. Accelerometer Gait Analysis
    const gaitScore = this.analyzeGaitPattern();
    
    if (gaitScore > 0.7) {
      // Check speed consistency
      const speedVariance = this.calculateSpeedVariance();
      
      if (speedVariance < 0.5) {  // Low variance = consistent walking
        return {
          state: 'WALKING_VALID',
          confidence: gaitScore * 0.9,
          reason: 'Gait pattern and speed consistency confirmed',
        };
      }
    }
    
    // 5. GPS Pattern Analysis
    const pathSmoothness = this.analyzePathSmoothness();
    
    // Vehicles have smoother paths, walkers have more variation
    if (pathSmoothness > 0.95 && avgSpeed > 1.5) {
      return {
        state: 'SUSPICIOUS',
        confidence: 0.6,
        reason: 'Path too smooth for walking',
      };
    }
    
    // Default: not confident enough
    return {
      state: 'SUSPICIOUS',
      confidence: 0.4,
      reason: 'Ambiguous movement pattern',
    };
  }
  
  private calculateAverageSpeed(): number {
    const speeds = this.sampleBuffer.map(s => s.gps.speed);
    return speeds.reduce((a, b) => a + b, 0) / speeds.length;
  }
  
  private calculateSpeedVariance(): number {
    const speeds = this.sampleBuffer.map(s => s.gps.speed);
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const squaredDiffs = speeds.map(s => Math.pow(s - avg, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / speeds.length;
    return Math.sqrt(variance);
  }
  
  private analyzeGaitPattern(): number {
    // Analyze accelerometer data for walking pattern
    // Walking has characteristic frequency ~2 Hz (2 steps/second)
    
    const magnitudes = this.sampleBuffer.map(s => s.accelerometer.magnitude);
    
    // Simple peak detection (production should use FFT)
    let peaks = 0;
    for (let i = 1; i < magnitudes.length - 1; i++) {
      if (magnitudes[i] > magnitudes[i - 1] && magnitudes[i] > magnitudes[i + 1]) {
        // Check if magnitude is in walking range
        if (magnitudes[i] > 1.1 && magnitudes[i] < 1.6) {
          peaks++;
        }
      }
    }
    
    // Expected: ~2 peaks per second, buffer is ~5 seconds
    const expectedPeaks = 10;
    const peakScore = Math.min(peaks / expectedPeaks, 1.0);
    
    // Check magnitude variance (walking has periodic pattern)
    const avgMag = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    const variance = magnitudes.reduce((sum, m) => sum + Math.pow(m - avgMag, 2), 0) / magnitudes.length;
    
    // Walking has moderate variance (0.05 - 0.2)
    const varianceScore = variance > 0.05 && variance < 0.2 ? 1.0 : 0.3;
    
    return (peakScore + varianceScore) / 2;
  }
  
  private analyzePathSmoothness(): number {
    // Calculate how smooth the GPS path is
    // Vehicles follow roads (smooth), walkers can cut through
    
    if (this.sampleBuffer.length < 3) return 0;
    
    const coords = this.sampleBuffer.map(s => ({
      lat: s.gps.latitude,
      lng: s.gps.longitude,
    }));
    
    let totalAngleChange = 0;
    
    for (let i = 1; i < coords.length - 1; i++) {
      const angle1 = this.calculateBearing(coords[i - 1], coords[i]);
      const angle2 = this.calculateBearing(coords[i], coords[i + 1]);
      const angleDiff = Math.abs(angle2 - angle1);
      totalAngleChange += Math.min(angleDiff, 360 - angleDiff);
    }
    
    const avgAngleChange = totalAngleChange / (coords.length - 2);
    
    // Low angle change = smooth path (vehicles)
    // High angle change = erratic path (walking or GPS noise)
    return 1.0 - Math.min(avgAngleChange / 180, 1.0);
  }
  
  private calculateBearing(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): number {
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }
}
```

## Server-Side Validation

**CRITICAL**: Client-side detection can be bypassed. Always validate on the server.

```typescript
// Backend validation service
class MovementValidationService {
  validateCollection(data: {
    userId: string;
    entityId: string;
    userLocation: { lat: number; lng: number };
    movementData: MovementSample[];
  }): { isValid: boolean; reason: string } {
    
    // 1. Check sample count
    if (data.movementData.length < 5) {
      return { isValid: false, reason: 'Insufficient movement data' };
    }
    
    // 2. Validate GPS accuracy
    const avgAccuracy = data.movementData.reduce(
      (sum, s) => sum + s.gps.accuracy, 0
    ) / data.movementData.length;
    
    if (avgAccuracy > 20) {
      return { isValid: false, reason: 'GPS accuracy too low' };
    }
    
    // 3. Check for impossible speeds
    const speeds = data.movementData.map(s => s.gps.speed);
    const maxSpeed = Math.max(...speeds);
    
    if (maxSpeed > 3.0) {  // Allow some margin
      return { isValid: false, reason: 'Speed exceeds walking threshold' };
    }
    
    // 4. Validate timestamp consistency
    const timestamps = data.movementData.map(s => s.timestamp).sort();
    const duration = timestamps[timestamps.length - 1] - timestamps[0];
    
    if (duration < 10000) {  // < 10 seconds
      return { isValid: false, reason: 'Collection too quick' };
    }
    
    // 5. Check for GPS spoofing patterns
    const locations = data.movementData.map(s => ({ 
      lat: s.gps.latitude, 
      lng: s.gps.longitude 
    }));
    
    // Spoofed GPS often jumps instantly to exact locations
    for (let i = 1; i < locations.length; i++) {
      const distance = this.haversineDistance(locations[i - 1], locations[i]);
      const timeDiff = (timestamps[i] - timestamps[i - 1]) / 1000; // seconds
      const speed = distance / timeDiff;
      
      if (speed > 5.0) {  // Teleportation detected
        return { isValid: false, reason: 'GPS spoofing detected' };
      }
    }
    
    // 6. Validate activity recognition consensus
    const walkingConfidence = data.movementData.filter(
      s => s.activityRecognition?.type === 'WALKING' && 
           s.activityRecognition?.confidence > 0.6
    ).length / data.movementData.length;
    
    if (walkingConfidence < 0.5) {
      return { isValid: false, reason: 'Activity recognition indicates not walking' };
    }
    
    return { isValid: true, reason: 'Movement validated' };
  }
  
  private haversineDistance(
    p1: { lat: number; lng: number },
    p2: { lat: number; lng: number }
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((p1.lat * Math.PI) / 180) *
              Math.cos((p2.lat * Math.PI) / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
```

## Mobile Implementation

### React Native Hook

```typescript
import { useState, useEffect, useRef } from 'react';
import { MovementDetector, MovementSample, MovementState } from '../services/movement';

export const useMovementDetection = () => {
  const [state, setState] = useState<MovementState>('UNKNOWN');
  const [confidence, setConfidence] = useState(0);
  const detectorRef = useRef(new MovementDetector());
  const [samples, setSamples] = useState<MovementSample[]>([]);
  
  useEffect(() => {
    // Initialize sensor subscriptions
    // (See 05-SETUP-MOBILE.md for full implementation)
    
    const onNewSample = (sample: MovementSample) => {
      const result = detectorRef.current.classify(sample);
      setState(result.state);
      setConfidence(result.confidence);
      
      // Keep last 30 samples for server validation
      setSamples(prev => {
        const updated = [...prev, sample];
        return updated.slice(-30);
      });
    };
    
    // Setup sensor listeners...
    
    return () => {
      // Cleanup
    };
  }, []);
  
  return {
    state,
    confidence,
    samples,
    isWalking: state === 'WALKING_VALID' && confidence > 0.7,
  };
};
```

## Testing Strategy

### Unit Tests

```typescript
describe('MovementDetector', () => {
  it('should detect vehicle when speed > 2.5 m/s', () => {
    const detector = new MovementDetector();
    const sample: MovementSample = {
      timestamp: Date.now(),
      gps: { speed: 5.0, accuracy: 5, ... },
      accelerometer: { magnitude: 1.0, ... },
    };
    
    const result = detector.classify(sample);
    expect(result.state).toBe('VEHICLE');
  });
  
  it('should detect walking with valid gait pattern', () => {
    // Test implementation
  });
});
```

### Integration Tests

Test with recorded real-world data:

```typescript
// Test data from actual walking sessions
const walkingData = require('./fixtures/walking-session.json');
const drivingData = require('./fixtures/driving-session.json');

test('Real walking data validates correctly', () => {
  const detector = new MovementDetector();
  
  walkingData.samples.forEach(sample => {
    const result = detector.classify(sample);
    // Should mostly be WALKING_VALID
  });
});
```

### Field Testing

1. **Walk test**: User walks normally, should validate
2. **Drive test**: User drives, should reject
3. **Bike test**: User bikes, should reject
4. **Spoof test**: Simulated GPS, should detect

## Performance Considerations

- Run detection on background thread (React Native worker)
- Throttle GPS updates to 1-2 seconds
- Buffer accelerometer data (100Hz → 10Hz)
- Cache classification results

## Tuning Parameters

Adjust these based on testing:

```typescript
const CONFIG = {
  MAX_WALKING_SPEED: 2.5,      // m/s - may need ±0.3 adjustment
  MIN_GPS_ACCURACY: 20,        // meters
  MIN_CONFIDENCE: 0.7,         // 0-1
  SAMPLE_BUFFER_SIZE: 10,      // number of samples
  GPS_UPDATE_INTERVAL: 2000,   // ms
  ACCEL_SAMPLE_RATE: 100,      // Hz
};
```

## Known Limitations

1. **Treadmills**: May register as walking (acceptable for MVP)
2. **GPS Drift**: Indoor/urban canyon GPS drift can cause false negatives
3. **Activity Recognition Lag**: iOS/Android APIs have 5-10s delay
4. **Battery Impact**: Continuous sensor use drains battery (optimize in production)

## Future Improvements

- ML model for gait classification (TensorFlow Lite)
- Barometer for elevation detection
- Step counter integration for additional validation
- User-specific calibration (height, stride length)
- Power efficiency optimizations

## Next Steps

1. Implement client-side detector: See mobile setup guide
2. Implement server-side validation: See backend guide
3. Test with real-world data
4. Tune parameters based on false positive/negative rates
