# Mobile app setup (Phase 1 — iOS sideload)

The JavaScript/TypeScript side of the app is committed (screens, hooks,
services, stores). The **native iOS project** (`mobile/ios/`) is generated
by the React Native CLI and must be created on your Mac. These steps walk
you through it.

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
| `built for newer iOS-simulator (14.0) than linked (13.4)` warnings      | Main target's `IPHONEOS_DEPLOYMENT_TARGET` → `14.0` (to match Podfile)                                                               |
| Metro: `Cannot find module 'babel-plugin-module-resolver'`              | `npm i --workspace=mobile -D babel-plugin-module-resolver`                                                                           |
| Metro: `Unable to resolve ./foo.js from shared/src/...`                 | Add `resolveRequest` `.js`→`.ts` fallback to `mobile/metro.config.js`                                                                |
| App crashes at JS start: `[Permissions] No permission handler detected` | Podfile must call `setup_permissions(['LocationWhenInUse', 'LocationAlways', 'Motion'])`                                             |

**Key rule for our monorepo**: any relative `require_relative` or shell
script in `mobile/ios/**` that references `node_modules` must use
`../../node_modules/` (two levels up), not `../node_modules/`. npm
workspaces hoist all deps to the repo root.
