# @parkwalk/mobile

React Native 0.73 app for iOS and Android. See `SETUP.md` for the full
first-time setup including the native iOS project, Android signing/Mapbox,
and the shared `.env`.

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
  ios/                       generated iOS Xcode project (after SETUP.md step 1)
  android/                   Android Gradle project (committed — Mapbox + signing wired)
  SETUP.md                   first-time setup (iOS + Android)
```

## Daily dev loop

```bash
# 1. Verify hosted API
curl https://parkwalk-production.up.railway.app/health

# 2. Start Metro
cd mobile && npm start

# 3a. iOS: build and run on iPhone from Xcode (Cmd-R)
# 3b. Android: in another terminal
cd mobile && npm run android   # debug build to attached device/emulator
```

## Outdoor cellular test loop

iOS — use the Xcode scheme **ParkWalkRelease** for a Metro-free build that
packages the JS bundle into the app, so the phone can run on cellular without
your Mac or local Wi-Fi.

Android — build a release APK that bundles the JS:

```bash
cd mobile && npm run android:apk
# output: mobile/android/app/build/outputs/apk/release/app-release.apk
```

Set `FIELD_DEBUG_OVERLAY=true` in `mobile/.env` before either build if you
want the field telemetry overlay in the Release build.

## Current architecture notes

- Auth tokens live in Keychain via `src/services/secureStorage.ts`.
- `src/services/apiClient.ts` injects the access token, silently refreshes
  once on 401, and updates Keychain/Zustand with rotated tokens.
- Settings sign-out revokes the refresh token through `POST /auth/logout`
  before clearing local auth state. If the network revoke fails, local
  credentials are still cleared.
- Map collection uses live GPS distance plus capped horizontal accuracy,
  matching the backend uncertainty-aware collect gate.
- When the user pans the map and their location leaves the visible viewport, a
  lower-right recenter button appears and flies the camera back to the latest
  GPS fix.
- The map has no debug overlay right now. Verify field-test behavior with
  collect alerts, Railway logs, and database rows.

## Current platform parity

iOS and Android share the React Native code in `src/`. Platform-specific gaps:

- **Native pedometer is iOS-only.** `src/native/Pedometer.ts` no-ops on
  Android (`Platform.OS !== 'ios'`). The walking classifier still works on
  Android via accelerometer-based step detection plus GPS speed; only the
  high-fidelity `CMPedometer` step counts and pace are unavailable. Adding a
  native step-counter (`Sensor.TYPE_STEP_COUNTER` or Health Connect) is the
  follow-up.
- **Background location.** iOS uses `UIBackgroundModes: location` to keep
  GPS alive with the screen off. Android requires a foreground service with
  `type="location"` plus `ACCESS_BACKGROUND_LOCATION`; that service is not
  yet wired up. On Android the app must stay in the foreground during a walk.
- **Activity recognition (`CMMotionActivity`)** is still stubbed on both
  platforms. `MovementSample.activity = 'UNKNOWN'`; the server enforces
  speed + accelerometer + teleport checks regardless.
- No app-level error boundary UI yet — Metro and Sentry cover dev; Phase 2
  adds a production error boundary.
