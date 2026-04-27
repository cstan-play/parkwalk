# Current Project Status

Last reviewed: 2026-04-27.

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
  user-location recenter control, marker tap collect flow, Stats, Settings,
  Keychain token storage, silent refresh, hosted HTTPS API settings, and no
  debug overlay on the map.
- **Infrastructure**: Railway backend runbook and local Docker
  Postgres/PostGIS/Redis for integration tests.

## Known Limits

- Raw accelerometer step detection is not reliable when iOS suspends the stream
  in pocket/background/locked-screen scenarios.
- The app currently has no on-map field diagnostic overlay. Use collect results,
  Railway logs, and database rows to verify behavior.
- `CMMotionActivity`, `CMPedometer`, and HealthKit are not wired yet.
- Offline Mapbox tile packs and walkable-way snapping are not implemented.
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
5. Verify the database: `user_stats.total_collections >= 1`,
   `user_stats.all_time_score >= 10`, and the latest `user_collections` row has
   `movement_validated = true`.
6. Save a real movement fixture under `backend/test/fixtures/`.

## Next Phases

### Phase 1 P0 — Finish The Walk Proof

- Complete one clean outdoor collect with Railway, auto-seeded or pre-seeded
  entities, and DB verification.
- Capture at least one real walking fixture and add it to backend tests.
- Decide whether the no-overlay map needs a small production-safe status affordance
  later, such as permission banners or collect-state toasts.

### Alpha P0 — Native Motion Reliability

- Add a native iOS module around `CMPedometer`.
- Add optional HealthKit reads for step count and walking/running distance.
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
