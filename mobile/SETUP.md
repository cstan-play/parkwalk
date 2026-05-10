# Mobile app setup (iOS + Android)

The JavaScript/TypeScript side of the app is committed (screens, hooks,
services, stores). The **native iOS project** (`mobile/ios/`) is generated
by the React Native CLI and must be created on your Mac; the **Android
project** (`mobile/android/`) is committed and ready to build.

> Sections 1–9 cover iOS. Section 10 covers Android — including the reviewer
> APK distribution flow.

## 1. Generate the React Native iOS project

From the repo root:

```bash
# Install monorepo dependencies first
npm install

# Generate the native iOS project shell alongside the committed JS.
# Use --skip-install so we can merge our template Podfile first.
cd mobile
npx @react-native-community/cli@13 init ParkWalk \
  --version 0.73.11 \
  --skip-install \
  --directory . \
  --install-pods false
# If the CLI complains that the directory is not empty, say "y" to continue.
```

What you should see afterwards:

```
mobile/
  ios/                 generated native iOS project (Xcode workspace + project)
  android/             generated (unused in Phase 1; leave it or delete)
  node_modules/        workspace-hoisted, already installed from root
  src/                 committed JS (unchanged)
  App.tsx              committed
  index.js             committed
  package.json         committed
```

If the CLI overwrote any of `App.tsx`, `index.js`, `package.json`,
`tsconfig.json`, `babel.config.js`, or `metro.config.js`, restore them from
git — they are the committed versions we want.

## 2. Replace the generated Info.plist and Podfile with our templates

```bash
# From mobile/
cp ios-setup/Info.plist ios/ParkWalk/Info.plist
cp ios-setup/Podfile ios/Podfile
```

Edit `ios/ParkWalk/Info.plist`:

- No API-specific App Transport Security exception is needed. The app talks
  to the hosted Railway API over HTTPS.

Edit `ios-setup/Podfile` if your project root is somewhere unusual, then copy
again. The default assumes `mobile/ios/Podfile` with `mobile/node_modules/`.

## 3. Configure the Mapbox secret token

`@rnmapbox/maps` fetches the Mapbox native iOS SDK via CocoaPods, which
authenticates with a Mapbox token scoped to `DOWNLOADS:READ`.

```bash
# In your home dir
cat >> ~/.netrc <<'EOF'
machine api.mapbox.com
  login mapbox
  password sk.your-secret-download-token
EOF
chmod 600 ~/.netrc
```

## 4. Install Pods

```bash
cd mobile/ios
pod install
cd ..
```

This downloads the Mapbox native SDK (first time ~200MB). If it fails, the
most common cause is a missing or misconfigured `~/.netrc`.

## 5. Configure .env for the Debug build

```bash
# In mobile/
cp .env.example .env
# Edit:
#   API_BASE_URL=              # optional hosted HTTPS staging override
#   MAPBOX_ACCESS_TOKEN=pk.your-public-runtime-token
#   MAPBOX_STYLE_URL=          # optional Mapbox Studio style URL, e.g. Warm
```

`react-native-config` reads this file at build time. Changing it requires a
rebuild (not just Metro reload). `API_BASE_URL` must be empty or an HTTPS URL;
local HTTP backends are not a supported mobile runtime path.

## 6. Configure Xcode signing

```bash
open mobile/ios/ParkWalk.xcworkspace
```

In Xcode:

- Select the **ParkWalk** project in the navigator.
- Select the **ParkWalk** target.
- **Signing & Capabilities** tab:
  - **Team**: `Personal Team (<Your Name>)` — your free Apple ID.
  - **Automatically manage signing**: ON.
  - **Bundle Identifier**: `com.<yourname>.parkwalk` (must be globally
    unique to your Apple ID; change `<yourname>`).
  - Click **+ Capability** → add **Background Modes**.
    - Check **Location updates**.
- Select your iPhone at the top-left device picker.

If signing fails with "No profiles for com.<yourname>.parkwalk":

- Try a different bundle ID.
- Or pick any other Team and then switch back to Personal Team.
- Or sign out of Xcode → Apple ID and back in.

## 7. Run on device

```bash
# In one terminal:
cd mobile && npm start

# In Xcode, hit Cmd-R with your iPhone plugged in.
```

First run on the phone will fail with "Untrusted Developer". Fix:

- On the iPhone, Settings → General → **VPN & Device Management**.
- Tap your Apple ID under "Developer App".
- **Trust** → confirm.
- Back to Xcode, run again. App launches.

## 8. Every ~7 days

Free provisioning expires. You'll see "Untrusted Developer" again. Plug the
iPhone in, hit Run in Xcode, permission renews for another 7 days. No code
changes needed.

## 9. Metro-free outdoor test build

Use this when you want to walk outside on cellular without depending on Metro,
your Mac, or local Wi-Fi.

The repo includes a shared Xcode scheme named **ParkWalkRelease**. It runs the
iOS target with Xcode's **Release** configuration. In Release, `AppDelegate.mm`
loads `main.jsbundle` from inside the app:

```objc
[[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"]
```

That bundle is produced by the Xcode build phase **Bundle React Native code and
images**, so the installed app can run without `npm start`.

Before building, decide whether you want the field diagnostics overlay in the
Release build:

```env
# mobile/.env
FIELD_DEBUG_OVERLAY=true
```

Set it to `false` for a cleaner product-like build. Changing `.env` requires
another Xcode build.

Steps:

1. Open `mobile/ios/ParkWalk.xcworkspace`.
2. In the scheme picker, select **ParkWalkRelease**.
3. Select your connected iPhone as the destination.
4. Product → Run.
5. After the app launches, disconnect Wi-Fi if desired and test on cellular.

Expected behavior:

- No "Cannot connect to Metro" warning.
- API calls go to the hosted Railway URL.
- Map tiles load from Mapbox over cellular.
- GPS/movement/collect behavior works without the Mac nearby.

If the app fails to launch in Release, first check Xcode's build log for the
React Native bundling phase. Common causes are missing `MAPBOX_ACCESS_TOKEN` in
`mobile/.env` or a stale build after changing `.env`.

## Troubleshooting

- **Pod install hangs on Mapbox**: bad `~/.netrc` or wrong token scope. The
  token must be an `sk.*` secret token with `DOWNLOADS:READ` scope.
- **Metro error "Unable to resolve module @parkwalk/shared"**: make sure you
  ran `npm install` from the repo root (not from `mobile/`). The workspace
  linkage depends on root-level `node_modules`.
- **401 from the backend on launch**: you haven't registered an account yet.
  The Onboarding screen routes you to Register.
- **App opens but no map tiles**: check `MAPBOX_ACCESS_TOKEN` in
  `mobile/.env`; it must be a `pk.*` public token. Rebuild after editing
  `.env` (Metro reload is not enough).
- **App can't reach backend**: Settings must show an `https://` Railway API
  URL. Open `https://<railway-url>/health` in iPhone Safari. If Safari works
  but the app does not, rebuild after editing `mobile/.env`.
- **Cannot connect to Metro**: you installed a Debug build. Use the
  **ParkWalkRelease** scheme for outdoor cellular tests that should not depend
  on Metro.
- **Constant "Background Location Indicator"**: expected behavior when
  `UIBackgroundModes: location` is enabled and the app is using GPS.

## Real-world gotchas (Apr 2026, Xcode 26 + RN 0.73 + npm workspaces)

The Apr 2026 bootstrap surfaced seven issues that the "happy path" above
does not anticipate. All seven are already fixed on `main` — a fresh clone
should build clean. If you ever re-bootstrap from
scratch (new Mac, RN upgrade, etc.) and hit any of these again, read
`docs/13-BOOTSTRAP-IOS.md` for the full diagnosis and the commit trail.
Quick cheat-sheet:

| Symptom                                                                 | Fix                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `react-native init` nukes committed files                               | `git checkout HEAD -- mobile/`                                                                                                       |
| Pod install: `cannot load '@rnmapbox/maps/scripts/install'`             | Podfile must call `$RNMapboxMaps.pre/post_install(installer)` inside hook blocks; don't set `$RNMapboxMapsDownloadToken = ''`        |
| Build: `with-environment.sh: No such file or directory`                 | `project.pbxproj` "Bundle React Native code and images" script: `../node_modules/` → `../../node_modules/` (monorepo hoists to root) |
| `built for newer iOS-simulator ... than linked ...` warnings            | Main target's `IPHONEOS_DEPLOYMENT_TARGET` → `15.0` (to match Podfile and Mapbox Maps v11)                                           |
| Metro: `Cannot find module 'babel-plugin-module-resolver'`              | `npm i --workspace=mobile -D babel-plugin-module-resolver`                                                                           |
| Metro: `Unable to resolve ./foo.js from shared/src/...`                 | Add `resolveRequest` `.js`→`.ts` fallback to `mobile/metro.config.js`                                                                |
| App crashes at JS start: `[Permissions] No permission handler detected` | Podfile must call `setup_permissions(['LocationWhenInUse', 'LocationAlways', 'Motion'])`                                             |

**Key rule for our monorepo**: any relative `require_relative` or shell
script in `mobile/ios/**` that references `node_modules` must use
`../../node_modules/` (two levels up), not `../node_modules/`. npm
workspaces hoist all deps to the repo root.

## 10. Android setup

The committed `mobile/android/` project builds against the same `mobile/.env`
and the same hosted backend. You do not need a Mac to build for Android.

### 10.1. Prerequisites

- **JDK 17** (Temurin or Zulu). `java -version` should report 17.x.
- **Android Studio** (Hedgehog or newer) with the SDK installed, or just
  the command-line **Android SDK** + `cmdline-tools`.
- An `ANDROID_HOME` env var pointing at the SDK root (typically
  `~/Library/Android/sdk` on macOS, `~/Android/Sdk` on Linux).
- Android SDK platforms **34** + build-tools **34.0.0** + NDK **25.1.8937393**
  (the values in `mobile/android/build.gradle`'s `ext` block). Easiest path:
  open the project once in Android Studio and accept the prompt to install
  matching versions.

If Gradle cannot find Java on macOS but Homebrew OpenJDK is installed, run
Gradle with:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
```

If Gradle cannot find the Android SDK, create `mobile/android/local.properties`
with your SDK path. This file is ignored by git:

```properties
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

### 10.2. Mapbox downloads token

The Android Mapbox SDK is fetched from a private Maven repo. You need a
secret token (scope `DOWNLOADS:READ`) — the same kind used in `~/.netrc`
for iOS, separate from the `pk.*` runtime token in `.env`.

Preferred: put it in `~/.gradle/gradle.properties` so it never enters the
repo:

```properties
MAPBOX_DOWNLOADS_TOKEN=sk.your-secret-download-token
```

Alternatively, edit `mobile/android/gradle.properties` and set the value
there (do NOT commit a real token).

`mobile/.env` must also contain a public runtime token:

```env
MAPBOX_ACCESS_TOKEN=pk.your-public-runtime-token
MAPBOX_STYLE_URL=mapbox://styles/your-username/your-style-id
```

### 10.3. Run on a device or emulator (debug)

```bash
# In one terminal: Metro
cd mobile && npm start

# In another terminal: build + install + launch
cd mobile && npm run android
```

The first build downloads the Android Mapbox SDK and Gradle dependencies
(~10 minutes, ~500MB). Subsequent builds are incremental.

### 10.4. Permissions on first launch

The app will prompt for:

- **Location (While using the app)** — required for the map and walk
  detection. Mirrors iOS *When In Use*.
- **Notifications** (Android 13+) — required for Gus reminders.

There is no Motion permission on Android; the accelerometer needs none.

> **Background location is not yet supported on Android.** The iOS app uses
> `UIBackgroundModes: location` to keep GPS alive with the screen off; the
> Android equivalent is a foreground service with `type="location"` plus
> `ACCESS_BACKGROUND_LOCATION`, which is not yet wired up. Keep ParkWalk in
> the foreground during a walk.

### 10.5. Release APK for reviewers

`npm run android:apk` produces a signed APK that includes the JS bundle, so
a reviewer can install it and walk on cellular without Metro:

```bash
cd mobile && npm run android:apk
# output: mobile/android/app/build/outputs/apk/release/app-release.apk
```

By default the release APK is signed with the **debug keystore**. That is
fine for sideloading to a known reviewer's phone — they enable "Install
unknown apps" once and tap the APK. It is **not** suitable for Play Store
or for reusing the same key across distributions.

To use a real release keystore (recommended for Firebase App Distribution
or any wider rollout):

```bash
# Generate a keystore (one time, keep the file safe)
cd mobile/android/app
keytool -genkeypair -v -storetype PKCS12 \
  -keystore parkwalk-release.keystore \
  -alias parkwalk \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then put the credentials in `~/.gradle/gradle.properties` (NOT in the repo):

```properties
PARKWALK_RELEASE_STORE_FILE=parkwalk-release.keystore
PARKWALK_RELEASE_STORE_PASSWORD=...
PARKWALK_RELEASE_KEY_ALIAS=parkwalk
PARKWALK_RELEASE_KEY_PASSWORD=...
```

`mobile/android/app/build.gradle` automatically uses these if present and
falls back to the debug keystore otherwise.

### 10.6. Distribute to a reviewer

Three options, in order of polish:

1. **Direct APK share.** Upload `app-release.apk` to Drive/Dropbox, send
   the link. Reviewer downloads, taps, allows "Install unknown apps" for
   their browser/file manager once. Done. No accounts needed on either side.
2. **Firebase App Distribution.** Free. Create a Firebase project, install
   `firebase` CLI, run `firebase appdistribution:distribute app-release.apk
   --app <appId> --testers reviewer@example.com`. They get an email link,
   tap to install, and get OTA updates for future builds. Closest thing to
   TestFlight on Android.
3. **Google Play Internal Testing.** Requires a one-time $25 Play Console
   fee. Use `npm run android:bundle` to produce an `.aab` instead and
   upload it to the Internal Testing track. Reviewer installs via the Play
   Store; clean experience but heaviest setup.

### 10.7. Android troubleshooting

- **`Could not resolve com.mapbox.maps:android:...`** — the Mapbox maven
  repo lookup failed. Verify `MAPBOX_DOWNLOADS_TOKEN` is set (either
  `~/.gradle/gradle.properties` or `mobile/android/gradle.properties`) and
  that the token has `DOWNLOADS:READ` scope.
- **`No such property: envConfigFiles`** or empty `Config.X` at runtime —
  `react-native-config`'s `dotenv.gradle` did not apply. Confirm
  `mobile/.env` exists and that you ran `npm install` from the repo root.
- **`Could not get unknown property 'react-native-config'`** during gradle
  sync — settings.gradle did not autolink. Re-run `npm install` from the
  repo root and try `cd mobile/android && ./gradlew --stop && ./gradlew
  clean`.
- **App installs but the map is blank** — `MAPBOX_ACCESS_TOKEN` is empty
  or invalid in `.env`. Rebuild after fixing (`.env` is read at build time
  on Android, not at runtime).
- **App can't reach backend** — Settings should show an `https://` Railway
  URL. The release manifest does not enable cleartext HTTP.
