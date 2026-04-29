# Current Project Status

Last reviewed: 2026-04-29.

## Where The Project Is

ParkWalk is in the **Phase 1 first-walk loop**. The iOS app, hosted backend,
PostGIS entity queries, auth, collection flow, and movement validation are all
implemented enough for a real iPhone walk test against Railway.

The current goal is not feature expansion. The goal is to prove the core loop:

1. iPhone reaches the hosted Railway backend over HTTPS.
2. User registers or logs in.
3. Map loads with seeded nearby collectibles.
4. GPS/movement samples are sent with a collect request.
5. Backend accepts plausible walking and rejects obvious abuse.
6. Stats increment and the collected marker disappears from nearby results.
7. A real walk fixture is saved from `user_collections.movement_data`.

## Implemented Today

- **Shared package**: Zod schemas, TypeScript types, and movement/game constants.
- **Backend**: Express REST API, Prisma, PostgreSQL/PostGIS, Redis-backed
  sessions/idempotency, health/ready endpoints, auth register/login/refresh/logout,
  nearby entities, collect transaction, and user stats.
- **Placement**: manual seed script plus `NEARBY_AUTO_SEED_ENABLED` dogfooding
  helper for shared nearby collectible clusters.
- **Movement validation**: GPS speed is primary; raw JS accelerometer steps and
  activity are corroborating. The server uses hard rejects plus persisted soft
  flags.
- **Mobile**: React Native iOS app with onboarding, auth screens, Mapbox map,
  user-location recenter control, Start/Pause/Resume/End walk controls, live
  route tracing, marker tap collect flow gated by an active walk, walk history
  and walk detail screens, Stats, Settings, Keychain token storage, silent
  refresh, hosted HTTPS API settings, and no product debug overlay on the map.
  A build-time `FIELD_DEBUG_OVERLAY` flag can show collapsible field telemetry
  in Metro-free Release builds without covering recovery controls.
- **Infrastructure**: Railway backend runbook and local Docker
  Postgres/PostGIS/Redis for integration tests.
- **Walk recording implementation**: shared walk schemas, backend walk sync/list/detail
  endpoints, `walk_sessions` migration, collection walk-client linking, mobile
  offline-first walk store, route line, auto-finish, unfinished-walk recovery,
  and native iOS `CMPedometer` bridge are implemented locally. First device
  build showed Start Walk works. Follow-up stabilization now makes End Walk
  local-first, throttles active-session persistence, prevents duplicate movement
  sample recording, excludes paused windows from native step totals, treats
  native steps as movement for auto-finish, replaces the unfinished-walk Alert
  with an on-map recovery panel, scopes local walk storage by authenticated
  user, shows moving time separately from paused time, opens the local Walk
  Detail screen immediately after End Walk, and exposes sync failure messages in
  Walks.

## Latest Field-Test Result

Manual `ParkWalkRelease` testing on iPhone passed the core recorded-walk loop:

- Start Walk updates timer, distance, and steps.
- Stats, Walks, and Settings open while a walk is active.
- Pause stops distance and step growth; moving-time display now holds steady
  while paused.
- Resume restarts movement metrics.
- End Walk clears controls promptly and opens Walk Detail from the local record.
- Force-close recovery Save/Discard works.
- Screen-lock walk plus pedometer backfill is plausible.
- Field diagnostics can be expanded/collapsed without freezing the UI.

The remaining failed check is cloud sync against Railway: completed local walks
show `Route not found: POST /api/v1/walks`. The route exists in local backend
code, so this means Railway is still running a backend revision that does not
include the walk API. After pushing to `main` and Railway deploying the new
backend, existing local `failed` walk sync entries should retry and become
`synced`.

## Known Limits

- Raw accelerometer step detection is not reliable when iOS suspends the stream
  in pocket/background/locked-screen scenarios.
- Railway production does not yet have the walk sync route until these changes
  are pushed and deployed; local walks remain saved on-device and retry sync.
- `CMMotionActivity` and HealthKit are not wired yet.
- Offline Mapbox tile packs and walkable-way snapping are not implemented.
- The mobile auth store restores tokens after app start, but not the full user
  object; local walk storage currently falls back to a generic authenticated
  owner after a cold relaunch. This is good enough for single-tester Alpha, but
  should be replaced by persisted user metadata or `/users/me` hydration before
  multi-account testing on one device.
- Web dashboard, friends graph/activity feed, Android, push notifications, and
  external TestFlight distribution are not part of the current working loop.

## Immediate Handoff

Use `docs/12-FIRST-WALK.md` as the checklist.

1. Verify `https://parkwalk-production.up.railway.app/health` and `/ready`, or
   the equivalent staging Railway URL.
2. Enable nearby auto-seeding on Railway, or seed a known route with
   `backend/prisma/seed.ts`.
3. Build/run the app on the iPhone from Xcode.
4. Register or log in, grant location/motion permissions, walk outside, and tap
   a marker.
5. After pushing these changes, wait for Railway to deploy; verify
   `POST /api/v1/walks` no longer returns `Route not found`.
6. Verify the database: `user_stats.total_collections >= 1`,
   `user_stats.all_time_score >= 10`, and the latest `user_collections` row has
   `movement_validated = true`.
7. Save a real movement fixture under `backend/test/fixtures/`.

## Next Phases

### Phase 1 P0 — Finish The Walk Proof

- Complete one clean outdoor collect with Railway, auto-seeded or pre-seeded
  entities, and DB verification.
- Capture at least one real walking fixture and add it to backend tests.
- Decide whether the no-overlay map needs a small production-safe status affordance
  later, such as permission banners or collect-state toasts.

### Alpha P0 — Native Motion Reliability

- Deploy and verify cloud sync for recorded walks:
  - Railway applies `20260428000000_walk_sessions`.
  - `POST /api/v1/walks`, `GET /api/v1/walks`, and `GET /api/v1/walks/:id`
    are reachable on the hosted API.
  - existing on-device `failed` walk sync rows retry to `synced`.
- Continue recorded walk sessions with manual **Start Walk** / **End Walk**,
  **Pause** / **Resume**, auto-finish, visible path trace, elapsed time,
  distance, and native `CMPedometer` step count. Walks are offline-first locally
  recorded and cloud-synced to the user's profile. See `15-WALK-RECORDING.md`.
- Defer optional HealthKit reads for step count and walking/running distance
  until the `CMPedometer` walk recorder is proven.
- Feed native step deltas through the existing `MovementSample.stepCountDelta`
  shape.
- Once reliable steps are available, reconsider which current soft flags become
  hard rejects.

### Alpha P1 — Field Robustness

- Add walkable-way snapping for seeded entities so markers do not land inside
  buildings/private areas.
- Add Mapbox offline tile packs around the player/test area.
- Tighten observability around collect failures without reintroducing a permanent
  debug overlay.

### Alpha P2 — Product Surface

- Friends graph and activity feed.
- Daily/weekly/all-time leaderboard views.
- Web dashboard for map management, moderation, stats, and activity review.

### Phase 2 — Broader Platform

- Android build.
- Paid Apple Developer/TestFlight/external testers.
- Push notifications.
- Real-time WebSocket/Socket.IO features if polling is no longer enough.
- Challenges/events engine.
