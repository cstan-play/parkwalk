# iOS Bootstrap Sprint — Status Log

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
- `mobile/.env` wired (`API_BASE_URL=http://10.26.4.68:3000`,
  `MAPBOX_ACCESS_TOKEN=pk.*`).
- `~/.netrc` holds the Mapbox `sk.*` with `DOWNLOADS:READ` scope for
  CocoaPods.

## What's blocked / deferred

- **End-to-end login**: the app points at `http://10.26.4.68:3000` which
  nobody is serving yet. Login/Register calls will error.
- **Map rendering + collect loop**: gated by login.
- **Deployment target** is set to iOS 14.0 to match rnmapbox-maps. This
  is fine for an MVP on a single dev iPhone but should be revisited if we
  ever widen device support.
- **LAN IP** (`10.26.4.68`) is hard-coded in `Info.plist` ATS exceptions.
  Move the Mac to a different network → update that IP or switch to
  ngrok HTTPS.
- **Free provisioning** expires every 7 days. To reprovision: plug in
  iPhone, Xcode → Run.
- **Many Xcode warnings** (hundreds) — all of them are either (a) iOS 26
  SDK deprecation notices from RN 0.73 internals, (b) CocoaPods script
  phases not declaring outputs, or (c) Apple privacy-manifest aggregation
  notes. None affect runtime. Will resolve when we upgrade RN (not for
  MVP).

## Next session

1. `docker compose up -d` in `infra/` — Postgres+PostGIS + Redis.
2. Create and apply Prisma schema; seed a handful of test entities
   within walking distance of the dev location.
3. `cd backend && npm run dev`.
4. Verify from the iPhone's Safari: `http://10.26.4.68:3000/health`
   returns JSON. (Mac firewall may need to allow Node.)
5. Reload the app on the phone → register → navigate to the Map screen
   → confirm blue markers appear → walk outside → confirm movement
   state flips to `WALKING_VALID` → tap a marker → collect.

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
