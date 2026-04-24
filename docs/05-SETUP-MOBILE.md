# Mobile App Setup Guide (React Native)

> Historical architecture sketch. The living ParkWalk mobile setup is
> `mobile/SETUP.md`; the current app talks to a hosted HTTPS API only.

## Prerequisites

- Node.js 18+
- **For iOS**: macOS with Xcode 14+
- **For Android**: Android Studio with SDK 33+
- Watchman (recommended)
- CocoaPods (for iOS)
- Mapbox account with API token

## Initial Setup

### 1. Create React Native Project

```bash
npx react-native@latest init WalkingGameApp --template react-native-template-typescript
cd WalkingGameApp
```

### 2. Install Core Dependencies

```bash
# Navigation
npm install @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
npm install react-native-screens react-native-safe-area-context
npm install react-native-gesture-handler react-native-reanimated

# Mapbox
npm install @rnmapbox/maps

# Location & Sensors
npm install react-native-geolocation-service
npm install react-native-sensors
npm install @react-native-community/geolocation

# Activity Recognition
npm install react-native-activity-recognition # iOS
npm install @react-native-community/google-fit # Android (optional)

# State Management
npm install zustand
npm install @tanstack/react-query

# API & WebSocket
npm install axios
npm install socket.io-client

# Storage
npm install @react-native-async-storage/async-storage

# Utilities
npm install date-fns
npm install react-native-vector-icons
```

### 3. iOS-Specific Setup

#### Install Pods

```bash
cd ios
pod install
cd ..
```

#### Info.plist Permissions

Edit `ios/WalkingGameApp/Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to show you nearby treasures and track your walks.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We need your location to track walks in the background.</string>
<key>NSMotionUsageDescription</key>
<string>We need motion data to verify you're walking (not driving).</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
</array>
```

#### Mapbox Token

Create `ios/WalkingGameApp/.env`:

```
MAPBOX_ACCESS_TOKEN=your-mapbox-token
```

Add to Info.plist:

```xml
<key>MBXAccessToken</key>
<string>$(MAPBOX_ACCESS_TOKEN)</string>
```

### 4. Android-Specific Setup

#### Gradle Configuration

Edit `android/app/build.gradle`:

```gradle
android {
    compileSdkVersion 33
    
    defaultConfig {
        minSdkVersion 24
        targetSdkVersion 33
        
        // Mapbox token
        manifestPlaceholders = [
            MAPBOX_ACCESS_TOKEN: project.findProperty('MAPBOX_ACCESS_TOKEN') ?: ''
        ]
    }
}

dependencies {
    // Mapbox
    implementation 'com.mapbox.maps:android:10.16.0'
    
    // Google Play Services (for location)
    implementation 'com.google.android.gms:play-services-location:21.0.1'
}
```

#### AndroidManifest.xml

Edit `android/app/src/main/AndroidManifest.xml`:

```xml
<manifest>
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
  <uses-permission android:name="com.google.android.gms.permission.ACTIVITY_RECOGNITION" />
  <uses-permission android:name="android.permission.INTERNET" />
  
  <application>
    <!-- Mapbox token -->
    <meta-data
      android:name="MAPBOX_ACCESS_TOKEN"
      android:value="${MAPBOX_ACCESS_TOKEN}" />
  </application>
</manifest>
```

#### Gradle Properties

Create `android/gradle.properties`:

```properties
MAPBOX_ACCESS_TOKEN=your-mapbox-token
```

### 5. Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── endpoints/
│   │   ├── auth.ts
│   │   ├── entities.ts
│   │   ├── users.ts
│   │   └── leaderboard.ts
│   └── websocket.ts
├── components/
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── LoadingSpinner.tsx
│   ├── map/
│   │   ├── MapView.tsx
│   │   ├── EntityMarker.tsx
│   │   └── UserLocation.tsx
│   └── game/
│       ├── CollectionButton.tsx
│       ├── EntityCard.tsx
│       └── StatsDisplay.tsx
├── screens/
│   ├── AuthScreen.tsx
│   ├── MapScreen.tsx
│   ├── ProfileScreen.tsx
│   ├── LeaderboardScreen.tsx
│   └── StatsScreen.tsx
├── services/
│   ├── location/
│   │   ├── LocationService.ts
│   │   └── types.ts
│   ├── movement/
│   │   ├── MovementDetector.ts
│   │   ├── ActivityRecognition.ts
│   │   └── types.ts
│   └── storage/
│       └── SecureStorage.ts
├── store/
│   ├── authStore.ts
│   ├── gameStore.ts
│   ├── locationStore.ts
│   └── types.ts
├── navigation/
│   ├── AppNavigator.tsx
│   ├── AuthNavigator.tsx
│   └── MainNavigator.tsx
├── hooks/
│   ├── useLocation.ts
│   ├── useMovementDetection.ts
│   └── useNearbyEntities.ts
├── utils/
│   ├── validation.ts
│   ├── formatting.ts
│   └── constants.ts
└── types/
    ├── models.ts
    └── api.ts
```

## Core Implementation

### 1. Environment Configuration

Create `.env`:

```env
# Optional hosted HTTPS staging override. Leave empty to use the bundled Railway origin.
API_BASE_URL=
MAPBOX_ACCESS_TOKEN=your-mapbox-token
```

Create `src/config/env.ts`:

```typescript
import Config from 'react-native-config';

export const env = {
  API_BASE_URL: Config.API_BASE_URL || 'https://parkwalk-production.up.railway.app/api/v1',
  MAPBOX_ACCESS_TOKEN: Config.MAPBOX_ACCESS_TOKEN || '',
};
```

### 2. API Client Setup

Create `src/api/client.ts`:

```typescript
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '../config/env';

const apiClient = axios.create({
  baseURL: env.API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add auth token
apiClient.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const refreshToken = await AsyncStorage.getItem('refresh_token');
        const { data } = await axios.post(`${env.API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });
        
        await AsyncStorage.setItem('access_token', data.access_token);
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Token refresh failed - logout
        await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
```

### 3. Location Service

Create `src/services/location/LocationService.ts`:

```typescript
import Geolocation from 'react-native-geolocation-service';
import { Platform, PermissionsAndroid } from 'react-native';

export interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

class LocationService {
  private watchId: number | null = null;
  
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      const status = await Geolocation.requestAuthorization('whenInUse');
      return status === 'granted';
    }
    
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'We need access to your location to show nearby treasures.',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    
    return false;
  }
  
  async getCurrentLocation(): Promise<Location> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp,
          });
        },
        (error) => reject(error),
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        }
      );
    });
  }
  
  startWatching(
    onLocation: (location: Location) => void,
    onError?: (error: any) => void
  ): void {
    this.watchId = Geolocation.watchPosition(
      (position) => {
        onLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp,
        });
      },
      (error) => onError?.(error),
      {
        enableHighAccuracy: true,
        distanceFilter: 5, // meters
        interval: 2000, // ms
        fastestInterval: 1000,
      }
    );
  }
  
  stopWatching(): void {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

export default new LocationService();
```

### 4. Movement Detection Hook

Create `src/hooks/useMovementDetection.ts`:

```typescript
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { accelerometer } from 'react-native-sensors';
import ActivityRecognition from 'react-native-activity-recognition';
import LocationService, { Location } from '../services/location/LocationService';

export type MovementState = 'WALKING_VALID' | 'VEHICLE' | 'STATIONARY' | 'UNKNOWN';

interface MovementData {
  state: MovementState;
  confidence: number;
  speed: number;
  stepRate: number;
}

export const useMovementDetection = () => {
  const [movementData, setMovementData] = useState<MovementData>({
    state: 'UNKNOWN',
    confidence: 0,
    speed: 0,
    stepRate: 0,
  });
  
  useEffect(() => {
    let accelSubscription: any;
    let activitySubscription: any;
    
    // iOS - use Core Motion
    if (Platform.OS === 'ios') {
      ActivityRecognition.subscribe((activity) => {
        const state = classifyActivity(activity.type, activity.confidence);
        setMovementData((prev) => ({
          ...prev,
          state,
          confidence: activity.confidence,
        }));
      });
    }
    
    // Accelerometer (both platforms)
    accelSubscription = accelerometer.subscribe(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      // Simple step detection (basic MVP)
      // Production: use more sophisticated algorithm
      const isWalkingPattern = magnitude > 1.1 && magnitude < 1.5;
      
      setMovementData((prev) => ({
        ...prev,
        stepRate: isWalkingPattern ? 2.0 : 0,
      }));
    });
    
    // GPS speed monitoring
    LocationService.startWatching((location: Location) => {
      const speedMps = location.speed || 0;
      const speedKmh = speedMps * 3.6;
      
      setMovementData((prev) => ({
        ...prev,
        speed: speedMps,
        state: speedKmh > 15 ? 'VEHICLE' : prev.state,
      }));
    });
    
    return () => {
      accelSubscription?.unsubscribe();
      activitySubscription?.unsubscribe();
      LocationService.stopWatching();
    };
  }, []);
  
  return movementData;
};

function classifyActivity(type: string, confidence: number): MovementState {
  if (confidence < 0.5) return 'UNKNOWN';
  
  switch (type) {
    case 'WALKING':
    case 'ON_FOOT':
      return 'WALKING_VALID';
    case 'IN_VEHICLE':
    case 'ON_BICYCLE':
      return 'VEHICLE';
    case 'STILL':
      return 'STATIONARY';
    default:
      return 'UNKNOWN';
  }
}
```

### 5. Mapbox Integration

Create `src/components/map/MapView.tsx`:

```typescript
import React, { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { env } from '../../config/env';

MapboxGL.setAccessToken(env.MAPBOX_ACCESS_TOKEN);

interface Props {
  onRegionChange?: (coords: [number, number]) => void;
}

const MapView: React.FC<Props> = ({ onRegionChange }) => {
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  
  return (
    <MapboxGL.MapView
      style={styles.map}
      styleURL="mapbox://styles/your-username/your-style-id"
    >
      <MapboxGL.Camera
        ref={cameraRef}
        followUserLocation
        followZoomLevel={15}
      />
      
      <MapboxGL.UserLocation
        visible
        onUpdate={(location) => {
          const coords: [number, number] = [
            location.coords.longitude,
            location.coords.latitude,
          ];
          setUserLocation(coords);
          onRegionChange?.(coords);
        }}
      />
    </MapboxGL.MapView>
  );
};

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});

export default MapView;
```

### 6. State Management (Zustand)

Create `src/store/authStore.ts`:

```typescript
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  
  login: async (email, password) => {
    // Implement login logic with API
  },
  
  logout: async () => {
    await AsyncStorage.multiRemove(['access_token', 'refresh_token']);
    set({ user: null, isAuthenticated: false });
  },
  
  loadUser: async () => {
    const token = await AsyncStorage.getItem('access_token');
    if (token) {
      // Fetch user from API
      set({ isAuthenticated: true, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },
}));
```

### 7. Navigation Setup

Create `src/navigation/AppNavigator.tsx`:

```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import AuthScreen from '../screens/AuthScreen';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';

import { useAuthStore } from '../store/authStore';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const MainTabs = () => (
  <Tab.Navigator>
    <Tab.Screen
      name="Map"
      component={MapScreen}
      options={{
        tabBarIcon: ({ color, size }) => (
          <Icon name="map" size={size} color={color} />
        ),
      }}
    />
    <Tab.Screen
      name="Leaderboard"
      component={LeaderboardScreen}
      options={{
        tabBarIcon: ({ color, size }) => (
          <Icon name="trophy" size={size} color={color} />
        ),
      }}
    />
    <Tab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{
        tabBarIcon: ({ color, size }) => (
          <Icon name="account" size={size} color={color} />
        ),
      }}
    />
  </Tab.Navigator>
);

const AppNavigator = () => {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  if (isLoading) {
    return null; // Loading screen
  }
  
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
```

## Running the App

### iOS

```bash
# Start Metro bundler
npm start

# Run on iOS (separate terminal)
npm run ios

# Or specific device
npm run ios -- --simulator="iPhone 15 Pro"
```

### Android

```bash
# Start Metro
npm start

# Run on Android (separate terminal)
npm run android
```

## Debugging

### React Native Debugger

```bash
brew install --cask react-native-debugger
```

### Flipper (Recommended)

Already integrated in React Native. Launch from:
- iOS: Xcode menu
- Android: Android Studio

### Remote Debugging

Shake device → "Debug" → Opens Chrome DevTools

## Common Issues

### Mapbox Build Errors

```bash
# iOS
cd ios && pod deintegrate && pod install

# Android - clean build
cd android && ./gradlew clean
```

### Location Permissions Not Working

Check `Info.plist` (iOS) and `AndroidManifest.xml` have correct permission strings.

### Metro Bundler Cache Issues

```bash
npm start -- --reset-cache
```

## Next Steps

1. Implement screens: `MapScreen`, `ProfileScreen`, etc.
2. Integrate movement detection: See `07-MOVEMENT-DETECTION.md`
3. Implement collection logic
4. Add WebSocket for real-time updates
5. Test on physical devices (GPS won't work on simulators)
