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
# 1. Verify hosted API
curl https://parkwalk-production.up.railway.app/health

# 2. Start Metro
cd mobile && npm start

# 3. Build and run on iPhone from Xcode (Cmd-R)
```

## Current architecture notes

- Auth tokens live in Keychain via `src/services/secureStorage.ts`.
- `src/services/apiClient.ts` injects the access token, silently refreshes
  once on 401, and updates Keychain/Zustand with rotated tokens.
- Settings sign-out revokes the refresh token through `POST /auth/logout`
  before clearing local auth state. If the network revoke fails, local
  credentials are still cleared.
- Map collection uses live GPS distance plus capped horizontal accuracy,
  matching the backend uncertainty-aware collect gate. Temporary local
  debug transport has been removed; the visible overlay remains the field
  diagnostic surface for the first-walk loop.

## Phase 1 deliberate limits

- iOS only (no Android).
- No push notifications, no HealthKit (free-provisioning blockers).
- Activity recognition from iOS CMMotionActivity is not wired up in Phase 1;
  `MovementSample.activity` is reported as UNKNOWN and the server still
  correctly rejects bad samples via speed + accelerometer + teleport checks.
  Wiring CMMotionActivity into a native module is a Phase 2 task.
- No app-level error boundary UI yet — Metro and Sentry cover dev; Phase 2
  adds a production error boundary.
