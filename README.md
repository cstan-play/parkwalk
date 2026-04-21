# ParkWalk

Location-based social walking game. iOS-first MVP with movement validation to detect genuine walking vs vehicle movement.

## Monorepo layout

```
ParkWalk/
  shared/     @parkwalk/shared   Zod schemas, TS types, domain constants
  backend/    @parkwalk/backend  Express + Prisma + PostGIS API
  mobile/     @parkwalk/mobile   React Native iOS app
  infra/                         Docker compose for local Postgres+PostGIS+Redis
  docs/                          Product + architecture docs
```

## Prerequisites (Phase 1 — free tier, solo tester)

- macOS with **Xcode 15+** installed and up to date.
- iPhone on **iOS 16+** with a cable.
- Free **Apple ID** signed into Xcode (Settings → Accounts). This gives you a "Personal Team" for free provisioning.
- **Mapbox** account with two tokens:
  - `pk.*` — public token for runtime map rendering.
  - `sk.*` with `DOWNLOADS:READ` scope — used by CocoaPods to fetch the native iOS Mapbox SDK. Stored in `~/.netrc`, not committed.
- **Node 20**, **npm 10**, **Docker Desktop**.

## First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres (with PostGIS) + Redis locally
npm run infra:up

# 3. Copy and fill backend env
cp backend/.env.example backend/.env
# edit backend/.env — set JWT_SECRET to anything random for dev

# 4. Run Prisma migrations and seed
cd backend
npm run prisma:migrate
npm run prisma:seed
cd ..

# 5. Start the backend
cd backend && npm run dev
# API is now on http://0.0.0.0:3000
# Find your Mac's LAN IP for the phone to reach it:
#   ipconfig getifaddr en0

# 6. Set up Mapbox secret token for mobile pod install
# Append to ~/.netrc (chmod 600):
#   machine api.mapbox.com
#     login mapbox
#     password sk.your-secret-download-token
#
# Then:
cd mobile
cp .env.example .env
# edit mobile/.env — set API_BASE_URL=http://<mac-lan-ip>:3000 and MAPBOX_ACCESS_TOKEN=pk.your-public-token
npm install
cd ios && pod install && cd ..

# 7. Open in Xcode, set signing, Run on device
open ios/ParkWalk.xcworkspace
#  - Signing & Capabilities:
#      Team: Personal Team (<your name>)
#      Bundle Identifier: com.<yourname>.parkwalk
#      Background Modes: Location updates (enabled)
#  - Connect iPhone via cable
#  - Product → Run

# 8. Trust the dev cert on your iPhone
#    Settings → General → VPN & Device Management → trust your Apple ID
```

## Daily dev loop

- Backend: `cd backend && npm run dev`
- Run on phone: `Cmd-R` in Xcode with phone plugged in.
- Every ~7 days: re-run from Xcode to refresh the free-provisioning cert.

## Testing the full walk

See `docs/12-FIRST-WALK.md` once it's written, or the "First-walk checklist" section in the foundation plan (`.cursor/plans/`).

Quick version:
1. `npm run infra:up` then `cd backend && npm run dev`.
2. Check `curl http://<mac-lan-ip>:3000/health` from both Mac and iPhone Safari.
3. Build & Run on iPhone from Xcode.
4. Register, walk outside 100m, confirm state flips to `WALKING_VALID`, collect a seeded entity.

## Phase 1 scope (what this repo does today)

- iOS app, foreground + background GPS, accelerometer-based movement classification.
- Backend with auth, nearby entities, collect-with-idempotency, stats.
- PostGIS spatial queries.
- Committed movement fixtures (walking / driving / teleport-spoof) with passing tests.
- Local docker Postgres+PostGIS+Redis.

## Phase 1 scope (what this repo explicitly defers to Phase 2)

- Web dashboard.
- Realtime WebSocket (leaderboard, activity feed) — pull-based in Phase 1.
- Push notifications (requires paid Apple Developer).
- TestFlight / external testers / cloud hosting.
- Challenge and MeetingPoint entity types.
- Android build.

See the foundation plan for full Phase 2 trigger conditions.
