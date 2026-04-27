# ParkWalk

Location-based social walking game. iOS-first MVP with movement validation to detect genuine walking vs vehicle movement.

## Monorepo layout

```
ParkWalk/
  shared/     @parkwalk/shared   Zod schemas, TS types, domain constants
  backend/    @parkwalk/backend  Express + Prisma + PostGIS API
  mobile/     @parkwalk/mobile   React Native iOS app
  infra/                         Docker compose for backend integration tests
  docs/                          Product + architecture docs
```

## Prerequisites (Phase 1 — free tier, solo tester)

- macOS with **Xcode 15+** installed and up to date.
- iPhone on **iOS 16+** with a cable.
- Free **Apple ID** signed into Xcode (Settings → Accounts). This gives you a "Personal Team" for free provisioning.
- **Mapbox** account with two tokens:
  - `pk.*` — public token for runtime map rendering.
  - `sk.*` with `DOWNLOADS:READ` scope — used by CocoaPods to fetch the native iOS Mapbox SDK. Stored in `~/.netrc`, not committed.
- **Node 20**, **npm 10**.
- Hosted Railway backend URL, e.g. `https://parkwalk-production.up.railway.app`.
- **Docker Desktop** only if you run backend integration tests locally.

## First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Deploy or verify the Railway backend
# See docs/14-DEPLOY-RAILWAY.md. Confirm:
#   https://<railway-url>/health
#   https://<railway-url>/ready

# 3. Set up Mapbox secret token for mobile pod install
# Append to ~/.netrc (chmod 600):
#   machine api.mapbox.com
#     login mapbox
#     password sk.your-secret-download-token
#
# Then:
cd mobile
cp .env.example .env
# edit mobile/.env — set MAPBOX_ACCESS_TOKEN=pk.your-public-token
# optional: set API_BASE_URL=https://<railway-staging-url> for hosted staging
npm install
cd ios && pod install && cd ..

# 4. Open in Xcode, set signing, Run on device
open ios/ParkWalk.xcworkspace
#  - Signing & Capabilities:
#      Team: Personal Team (<your name>)
#      Bundle Identifier: com.<yourname>.parkwalk
#      Background Modes: Location updates (enabled)
#  - Connect iPhone via cable
#  - Product → Run

# 5. Trust the dev cert on your iPhone
#    Settings → General → VPN & Device Management → trust your Apple ID
```

## Daily dev loop

- Backend: Railway hosted API.
- Run on phone: `Cmd-R` in Xcode with phone plugged in.
- Every ~7 days: re-run from Xcode to refresh the free-provisioning cert.
- Backend tests only: `npm run infra:up`, then backend migrations/tests.

## Testing the full walk

See `docs/12-FIRST-WALK.md` for the full checklist.

Quick version:

1. Check `https://<railway-url>/health` and `/ready`.
2. In the app Settings, confirm the API URL is the hosted HTTPS API.
3. Build & Run on iPhone from Xcode.
4. Register, grant permissions, walk outside, and tap a nearby marker to
   collect. Verify success in the app and with the database checks in
   `docs/12-FIRST-WALK.md`.

Current handoff: `docs/00-CURRENT-STATUS.md`.

## Phase 1 scope (what this repo does today)

- iOS app, foreground + background GPS, accelerometer-based movement classification.
- Backend with auth, nearby entities, collect-with-idempotency, stats.
- PostGIS spatial queries.
- Committed movement fixtures (walking / driving / teleport-spoof) with passing tests.
- Local docker Postgres+PostGIS+Redis for backend integration tests.

## Not in the current walk loop

- Web dashboard.
- Realtime WebSocket (leaderboard, activity feed) — pull-based in Phase 1.
- Push notifications (requires paid Apple Developer).
- TestFlight / external testers.
- Challenge and MeetingPoint entity types.
- Android build.

See `docs/00-CURRENT-STATUS.md` for the current phase breakdown and next
milestones.
