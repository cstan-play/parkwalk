# iOS Bootstrap Sprint — Status Log

> **Project scope**: ParkWalk is an **MVP + Alpha** build — see `docs/README.md`.
> This doc records the iOS-bootstrap slice of Phase 1; "deferred" items below
> are now in-scope for the Alpha timeline (weeks 7–10), not post-launch wishes.

**Goal of this sprint**: take the existing React Native / TypeScript source
(committed before this sprint) and get a signed build running on a real iPhone.
This does not include the backend; the mobile app can launch, render the
Onboarding screen, and request iOS permissions, but cannot log in yet.

**Timeline**: April 2026, single session.
**Branch**: `bootstrap/ios` (not yet merged to `main`).
**Toolchain discovered on the dev Mac**: Xcode 26.4.1, iOS 26.4 SDK,
CocoaPods 1.16.2, Node 20.20.2 (via nvm), React Native 0.73.11.

## What was planned (from `mobile/SETUP.md`)

1. `npm install` at repo root (npm workspaces).
2. Generate native iOS project via `@react-native-community/cli@13 init`.
3. Overlay `mobile/ios-setup/Info.plist` and `Podfile` templates.
4. Configure Mapbox `sk.*` token in `~/.netrc`, `pk.*` in `mobile/.env`.
5. `pod install`.
6. Set up Apple ID signing in Xcode (free Personal Team).
7. `Cmd+R` — app runs on iPhone.

## What actually happened

The above sequence is essentially correct, but six issues surfaced that the
original SETUP.md did not predict. Each one was a separate "Command
PhaseScriptExecution failed" or a crash at first JS execution.

| # | Issue | Root cause | Fix |
|---|---|---|---|
| 1 | `react-native init` deleted committed files in `mobile/` | The CLI overwrites TS files silently when run in a non-empty directory | `git checkout HEAD -- mobile/`; kept the generated native-only files |
| 2 | `pod install` failed: `cannot load '@rnmapbox/maps/scripts/install'` | In `rnmapbox-maps@10.1.30` that script no longer exists; `$RNMapboxMaps` is defined by the podspec itself. Also `$RNMapboxMapsDownloadToken = ''` (truthy) broke `~/.netrc` auth | Podfile calls `$RNMapboxMaps.pre_install(installer)` and `.post_install(installer)` inside the hook blocks; removed the bogus download-token line |
| 3 | Build failed: `../node_modules/react-native/scripts/xcode/with-environment.sh: No such file or directory` | RN-CLI's "Bundle React Native code and images" script uses `../node_modules/`, which is `mobile/node_modules/` — missing because npm workspaces hoisted to repo root | Changed the script phase in `project.pbxproj` to `../../node_modules/` |
| 4 | Linker spam about "built for newer iOS-simulator (14.0) than linked (13.4)" | Main target's `IPHONEOS_DEPLOYMENT_TARGET` was 13.4 (RN 0.73 default) but the Podfile forced all pods to 14.0 for Mapbox + rnmapbox | Set main-target deployment target to 14.0 (4 occurrences in `project.pbxproj`) |
| 5 | Metro crashed: `Cannot find module 'babel-plugin-module-resolver'` | `mobile/babel.config.js` uses the plugin to resolve `@/*` path aliases but it was never declared in `mobile/package.json` | `npm install --workspace=mobile --save-dev babel-plugin-module-resolver` |
| 6 | Metro crashed: `Unable to resolve ./schemas/index.js from shared/src/index.ts` | The `@parkwalk/shared` workspace uses TypeScript NodeNext ESM convention (explicit `.js` extensions on imports of `.ts` files); Metro's default resolver doesn't strip `.js` → `.ts` | Added a custom `resolveRequest` fallback in `mobile/metro.config.js` |
| 7 | App launched then crashed at JS startup: `[Permissions] No permission handler detected` | `react-native-permissions@4.1.5` ships no handlers by default; the Podfile must call `setup_permissions(['LocationWhenInUse', 'LocationAlways', 'Motion'])` | Added the call in the Podfile (after `require_relative '.../scripts/setup'`) |

Once all seven fixes were in place, the iOS build succeeded on first
try, installed on the iPhone, and the Onboarding screen rendered with
working iOS location + motion permission prompts.

## Commit trail on `bootstrap/ios`

```
71a9f7d fix(mobile/ios): register react-native-permissions handlers in Podfile
f016460 fix(mobile): install babel-plugin-module-resolver; teach Metro .js->.ts fallback
1b06e70 fix(mobile/ios): resolve build script path and bump deployment target
f71dbfd chore(mobile/ios): run pod install; fix Podfile Mapbox hook integration
c658be4 chore(mobile/ios): overlay ParkWalk Info.plist and Podfile templates
3971066 chore(mobile): generate ios native project via react-native-community/cli init
35637c6 chore: gitignore mobile/android (iOS-first, Android deferred to Phase 2)
```

Each commit message carries the reproduction + fix, so a future clean
re-bootstrap (e.g. on another Mac, or after an RN upgrade) can be
reconstructed by reading the log on this branch.

## What works on the device today

- Native build on Xcode 26 / iOS 26 SDK / arm64, signed with free
  Personal Team.
- Hermes JS engine boots, renders the navigation stack.
- Onboarding → Login → Register screens functional (UI only).
- iOS runtime permission prompts fire for **LocationWhenInUse**,
  **LocationAlways**, and **Motion**, with our custom Info.plist strings.
- Mapbox iOS SDK is bundled and signed (not yet exercised — MapScreen is
  unreachable without auth).
- Background modes: `location`, `fetch` declared.
- `mobile/.env` wired (`MAPBOX_ACCESS_TOKEN=pk.*`; `API_BASE_URL` is empty
  for the default Railway API or an HTTPS hosted staging override).
- `~/.netrc` holds the Mapbox `sk.*` with `DOWNLOADS:READ` scope for
  CocoaPods.

## What's blocked by this sprint's scope

- **End-to-end login**: now uses the hosted Railway API over HTTPS.
- **Map rendering + collect loop**: gated by login (next sprint).
- **Free provisioning** expires every 7 days. To reprovision: plug in
  iPhone, Xcode → Run. (Not a bug; Apple's free-tier contract.)
- **Many Xcode warnings** (hundreds) — all of them are either (a) iOS 26
  SDK deprecation notices from RN 0.73 internals, (b) CocoaPods script
  phases not declaring outputs, or (c) Apple privacy-manifest aggregation
  notes. None affect runtime. Revisited when we upgrade RN.

## Retro: first-walk attempt (Apr 2026)

First live walk with the Copenhagen seed (15 markers in an 80m disc, all
in Wi-Fi range) produced the following findings:

- **GPS worked well.** Speed was tracked correctly; nearby-entity query
  returned all 15 markers within 500m.
- **Accelerometer / step rate never updated while walking.** Root cause:
  `react-native-sensors` uses `CMMotionManager` on iOS, which iOS
  suspends when the app backgrounds or the screen locks. Normal pocketed
  walking kills the stream. The detector resumed the moment the user put
  the phone back on their desk, confirming the diagnosis.
- **Classifier was gated on step rate.** With stepRate=0 the client
  classifier fell through to `UNKNOWN`, and the server rejected the
  collect attempt with `Not yet. Current movement state: UNKNOWN`. The
  anti-cheat pipeline worked exactly as specified — but the specification
  was too strict for the stated goal (reject driving/biking, not reject
  pocketed walks).

Design change landed in the same session:

- `classify()` and `computeScore()` in `mobile/src/hooks/useMovementDetection.ts`
  refactored. Speed is now the primary anti-cheat signal; step rate and
  CoreMotion activity are secondary (corroborating, optional, neutral
  when absent). Full rationale: `docs/07-MOVEMENT-DETECTION.md`
  "Signal priority" section.
- 11 classifier tests committed at `mobile/src/hooks/useMovementDetection.test.ts`
  lock the contract so this isn't re-tightened by accident.
- Jest resolver updated to handle TypeScript NodeNext `.js` imports in
  the shared workspace (same fix we made for Metro earlier).
- 5 pedometer tests at `mobile/src/sensors/stepDetector.test.ts` prove
  the peak-detection algorithm is correct — it's the iOS sensor
  availability that's the limitation, not our code.

The pedometer stays in the pipeline, still contributes to the score
when available, and becomes a hard gate only after we ship the
native-module CMPedometer wrapper (Alpha follow-up below).

## Retro: second-walk attempt (Apr 2026)

Second live walk after the first-walk classifier relax. Three findings
this round — one GPS, one collect-path, one pedometer. None of them
touched the core architecture; all three had concrete config/tuning
fixes that landed in the same session.

- **GPS drift regressed.** `averageAccuracyMeters` sat at 25-60 m while
  walking on the same route that reported 5-20 m the first time. Root
  cause: `watchPosition` was only passing `enableHighAccuracy: true`
  (maps to `kCLLocationAccuracyBest`) and iOS was pausing updates
  whenever it decided the user was "stationary", causing a cold-start
  drift each time motion resumed. Fix: added
  `accuracy: { ios: 'bestForNavigation' }` and
  `pauseUpdatesAutomatically: false` to the `watchPosition` options in
  `mobile/src/sensors/productionSource.ts`. Also raised
  `GPS_MAX_ACCURACY_METERS` from 20 → 35 in `shared/src/constants.ts`
  to match real-world urban reporting; see
  `docs/07-MOVEMENT-DETECTION.md` for rationale.
- **Collect timed out at 15 s with no retry.** A single flaky wifi
  packet killed the whole action. Fixes: dropped the per-attempt
  timeout from 15 s → 8 s and added idempotency-aware retry-with-backoff
  (3 attempts, 400 ms / 1200 ms jitter) in
  `mobile/src/services/apiClient.ts`. The server's existing
  `Idempotency-Key` route guarantees replays return the stored result
  rather than double-collecting. UI now shows `collect: sending` /
  `collect: retry 2/3` in the debug overlay, disables tapping other
  markers mid-collect, and distinguishes too-far / network / hard-reject
  errors in the alert body.
- **Pedometer still produced zero steps while hand-held.** Root cause:
  the gravity-compensated peak-detection threshold was set at
  `1.0 m/s²`, which is the right value for pocketed walking (strong
  vertical bounce) but too high for hand-held walking where arm-swing
  peaks at 0.6-0.9 m/s² above gravity. Fix: lowered
  `peakThresholdMps2` to `0.6` in `mobile/src/sensors/stepDetector.ts`;
  all 5 existing unit tests still pass. This is a bandaid; see the
  Alpha P0 milestone below for the real fix.
- **Server-side validation shifted to a soft-flag model.** The previous
  validator rejected a legitimate walk on any of: low GPS accuracy,
  zero step rate, UNKNOWN activity, low client score, stale summary.
  Every one of those fires for a correct pocketed walk on current iOS.
  Refactor: `validateMovement` now returns
  `{ valid, state, score, reasons, flags }` where `reasons` are hard
  rejects (teleport, automotive activity, missing samples,
  future-dated summary) and `flags: MovementFlag[]` are soft evidence
  persisted to `collection_log.movement_data.flags` but not blocking.
  The **collect** spatial gate uses PostGIS distance plus an
  **uncertainty-aware** rule (`horizontalAccuracy` capped at 35 m) so
  indoor / campus Wi-Fi positioning does not false-reject legitimate
  taps; a separate **hard limit** still blocks obvious long-range abuse.
  **`/entities/nearby`** omits entities the current user has already
  collected so markers disappear after a successful pick-up. Full rules
  in `docs/07-MOVEMENT-DETECTION.md` ("Soft-flag validation model" and
  "Spatial collect gate").
- **Client live distance + GPS smoother.** Map tap proximity uses live
  haversine from the same fix sent in the collect body (not stale
  `distanceMeters` from the last nearby fetch). GPS fixes pass through a
  short `pickBestFix` buffer to reduce single-sample accuracy spikes.

## Alpha P0 milestone: Native pedometer + HealthKit (promoted)

Previously filed as follow-up #7 "nice to have"; second-walk evidence
makes it a Phase 1 Alpha P0 milestone. The raw-accelerometer peak
detector is tuned as well as it can be from JS; the remaining failure
modes are all platform-level (iOS suspending the stream when the screen
locks, background-walk steps being lost entirely, no cross-device
aggregation). Pokémon GO solves exactly this with Adventure Sync —
which is CMPedometer/CMMotionActivity talking to Apple Health. The
scope for this milestone:

- **Native iOS module** wrapping `CMPedometer`. Two entry points:
  `queryPedometerData(from:to:)` to backfill steps for any window
  including time when the app was backgrounded or suspended; and
  `startPedometerUpdates(from:)` to stream step + cadence deltas while
  the app is foreground or in the background-location-updates state
  we already entitle.
- **Optional HealthKit read** for `HKQuantityTypeIdentifierStepCount`
  and `HKQuantityTypeIdentifierDistanceWalkingRunning`. Users who have
  Apple Watch / third-party trackers get aggregated step counts for
  free, matching Adventure Sync's behavior.
- **Adapter over `createStepDetector`.** The current
  `mobile/src/sensors/stepDetector.ts` stays as a fallback when the
  native module is unavailable (e.g. simulator, Android when we add
  it). Both sources feed the same `MovementSample.stepCountDelta`
  shape, so the classifier, the server validator, and the stats
  dashboard are unchanged.
- **Background step accrual.** Unlocks "phone in pocket during a
  park walk, screen locked, still counting steps" as a first-class
  mode — the one we've been approximating with the raw-accel
  detector.
- **Graduation of soft flags.** Once CMPedometer is wired,
  `NO_STEPS_DURING_MOVEMENT` and `FLAT_ACCELEROMETER_WITH_GPS` become
  hard rejects (background step data is reliable, so their absence is
  genuinely suspicious). See the flags table in
  `docs/07-MOVEMENT-DETECTION.md`.

This milestone also unblocks the "record steps from start location to
each collectible" stats dashboard mentioned in the product scope — the
pipeline is already plumbed to accept step deltas, we just need a
reliable source.

## Alpha-scope follow-ups (Phase 1, weeks 7–10)

These were originally tagged "Phase 1.5 / deferred" when the project was
framed as a strict MVP. Under the MVP+Alpha framing they are in-scope for
Phase 1 and tracked here so we don't lose them:

1. **Walkable-way snapping for seeded entities**. Current seed script
   (`backend/prisma/seed.ts`) places markers uniformly on a disc with
   rejection-sampled minimum spacing — great for dense, alpha-grade
   layouts in open terrain, but markers can still land in
   buildings/private yards. Alpha upgrade: snap each candidate to the
   nearest OSM footway/sidewalk/path via Overpass or a local extract
   before insert. Tracked in `docs/08-GAME-ENTITIES.md`.
2. **Offline map tiles**. MapScreen uses Mapbox Streets with no
   `OfflineManager` — a dropped cellular signal blanks the map
   mid-walk. Alpha upgrade: pre-download a ~500m tile pack around the
   user on first launch.
3. **Auth session refresh — done for Phase 1.** The API client now retries
   a single 401 via `/api/v1/auth/refresh`, rotates stored Keychain tokens,
   and clears local auth state if refresh fails.
4. **Explicit logout wiring — done for Phase 1.** Settings sign-out calls
   `POST /auth/logout` with the refresh token, then clears Keychain and
   resets Zustand even if the revoke request fails.
5. **Hosted API only — done for Phase 1.** The mobile app no longer supports
   LAN/ngrok/local HTTP API targets. `API_BASE_URL` is optional and must be a
   hosted HTTPS API URL; otherwise the compiled Railway origin is used.
6. **iOS 14 deployment target**. Set to match rnmapbox-maps. Revisit
   when we widen device support (unlikely before public beta).
7. **Native CMPedometer wrapper** — **promoted to Alpha P0 milestone
   above**. Left as a line item here so the numbering in older commit
   messages still resolves.
8. **Mac-side firewall / IP drift — obsolete.** Railway HTTPS is now the only
   supported mobile API path, so DHCP, ATS IP exceptions, and Mac firewall
   issues are no longer part of the first-walk loop.

## Next session

1. Verify Railway `/health` and `/ready`.
2. Enable `NEARBY_AUTO_SEED_ENABLED=true` on Railway or run the seed script as
   a Railway one-off command near the test route.
3. Reload the app on the phone → register → Map screen → walk outside
   → confirm movement state flips to `WALKING_VALID` → tap marker → collect.

Reference: `docs/04-SETUP-BACKEND.md`, `docs/02-DATABASE-SCHEMA.md`,
`docs/12-FIRST-WALK.md`.

## Files touched during this sprint

- Added: `docs/13-BOOTSTRAP-IOS.md` (this file).
- Modified: `mobile/ios/Podfile`, `mobile/ios-setup/Podfile`,
  `mobile/ios/Podfile.lock`, `mobile/ios/ParkWalk.xcodeproj/project.pbxproj`,
  `mobile/ios/ParkWalk/Info.plist` (Xcode cosmetic reformat),
  `mobile/metro.config.js`, `mobile/package.json`, `package-lock.json`,
  `.gitignore`.
- Generated (not committed): `mobile/ios/Pods/` (ignored, 512 MB).
- User-local (not committed): `~/.netrc`, `mobile/.env`,
  `mobile/ios/.xcode.env.local`.
