# @parkwalk/mobile

React Native 0.73 iOS app (Phase 1). See `SETUP.md` for the full
first-time setup including generating the native iOS project, signing with
a free Apple ID, and configuring Mapbox.

## Directory layout

```
mobile/
  App.tsx                    root component
  index.js                   RN entrypoint
  src/
    navigation/              React Navigation stack
    screens/                 Onboarding / Login / Register / Map / Stats / Settings
    hooks/                   useMovementDetection, usePermissions, useIdempotencyKey
    sensors/                 productionSource (real GPS+accel), fixtureSource (tests)
    services/                apiClient (axios+refresh), authApi, entitiesApi, statsApi, secureStorage
    stores/                  authStore, settingsStore (zustand)
  ios-setup/                 templates for ios/Podfile and ios/ParkWalk/Info.plist
  SETUP.md                   first-time setup
```

## Daily dev loop

```bash
# 1. Start backend (separate terminal, at repo root)
npm run infra:up
cd backend && npm run dev

# 2. Start Metro
cd mobile && npm start

# 3. Build and run on iPhone from Xcode (Cmd-R)
```

## Phase 1 deliberate limits

- iOS only (no Android).
- No push notifications, no HealthKit (free-provisioning blockers).
- Activity recognition from iOS CMMotionActivity is not wired up in Phase 1;
  `MovementSample.activity` is reported as UNKNOWN and the server still
  correctly rejects bad samples via speed + accelerometer + teleport checks.
  Wiring CMMotionActivity into a native module is a Phase 2 task.
- No app-level error boundary UI yet — Metro and Sentry cover dev; Phase 2
  adds a production error boundary.
