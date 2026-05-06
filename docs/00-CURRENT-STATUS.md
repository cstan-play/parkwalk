# Current Project Status

Last reviewed: 2026-05-01.

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
  helper for shared nearby collectible clusters. Both paths can optionally snap
  candidate markers to Mapbox Streets walkable ways through the backend
  `WALKABLE_SNAPPING_ENABLED` Alpha flag.
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
  Walks. Route storage is being reset for Alpha to `pathSegments`, so Pause
  closes one route segment and Resume starts another; maps render the walk as a
  `MultiLineString` instead of drawing a false line through paused time.

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

Cloud sync became available after the walk API deploy. The next local build
should validate the new route-segment schema reset: old Alpha walks are
discarded locally and deleted from `walk_sessions` by the backend migration, and
newly completed walks should sync with `path_segments`.

## Known Limits

- Raw accelerometer step detection is not reliable when iOS suspends the stream
  in pocket/background/locked-screen scenarios.
- Railway production does not yet have the route-segment migration until these
  changes are pushed and deployed; local walks remain saved on-device and retry
  sync.
- Previous Alpha walk history is intentionally not preserved during the
  `pathSegments` reset.
- `CMMotionActivity` and HealthKit are not wired yet.
- Walkable-way snapping is implemented behind backend env flags, but is not yet
  field-verified on Railway. Enable `WALKABLE_SNAPPING_ENABLED=true` with a
  server-side `MAPBOX_ACCESS_TOKEN` before testing snapped placements outdoors.
- Offline Mapbox tile packs are intentionally de-prioritized for Alpha unless
  field tests show cellular map loading is a real blocker, or unless a custom
  map/art direction specifically requires local tile packaging. Custom map
  styles and collectible graphics do not require offline tiles by default.
- The mobile auth store restores tokens after app start, but not the full user
  object; local walk storage currently falls back to a generic authenticated
  owner after a cold relaunch. This is good enough for single-tester Alpha, but
  should be replaced by persisted user metadata or `/users/me` hydration before
  multi-account testing on one device.
- Web dashboard, friends graph/activity feed, push notifications, and external
  TestFlight distribution are not part of the current working loop.
- Android is dropped from the active roadmap. Keep shared contracts portable
  where it is cheap, but do not plan, staff, or sequence Android work.

## Immediate Handoff

Use `docs/12-FIRST-WALK.md` as the checklist.

1. Verify `https://parkwalk-production.up.railway.app/health` and `/ready`, or
   the equivalent staging Railway URL.
2. Enable nearby auto-seeding on Railway, or seed a known route with
   `backend/prisma/seed.ts`. For walkable-way snapping tests, also set
   `WALKABLE_SNAPPING_ENABLED=true` and `MAPBOX_ACCESS_TOKEN`.
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
  - Railway applies `20260428000000_walk_sessions` and
    `20260501000000_walk_path_segments`.
  - `POST /api/v1/walks`, `GET /api/v1/walks`, and `GET /api/v1/walks/:id`
    are reachable on the hosted API.
  - new on-device walks sync to `synced` with segmented route storage.
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

- Field-test Mapbox Tilequery walkable-way snapping for seeded entities so
  markers do not land inside buildings/private areas.
- Defer Mapbox offline tile packs unless cellular reliability, styling, or
  custom map asset delivery proves they are needed.
- Tighten observability around collect failures without reintroducing a permanent
  debug overlay.

### Alpha P2 — Product Surface

- Friends graph and activity feed.
- Daily/weekly/all-time leaderboard views.
- Web dashboard for map management, moderation, stats, and activity review.

### Phase 2 — Broader Platform

- Paid Apple Developer/TestFlight/external testers.
- Push notifications.
- Real-time WebSocket/Socket.IO features if polling is no longer enough.
- Challenges/events engine.
