# ParkWalk - MVP + Alpha Documentation

## Project Overview

A cross-platform location-based social walking game where users collect items, hide treasures, and participate in challenges while walking in their city. The system validates that users are genuinely walking (not driving/biking) using GPS and device sensors.

## Scope: MVP + Alpha (not just "minimum viable")

> **Why the name matters.** A pure MVP cuts corners to prove the idea. ParkWalk
> is instead being built as a **MVP + Alpha**: the thinnest end-to-end slice
> still uses production-grade architecture, so every follow-up feature can be
> layered on without a rewrite. That means: solid domain boundaries, typed
> schemas, tested services, server-side anti-cheat, and infra-as-code from day
> one — even when only a single tester is walking around with an iPhone.
>
> In practice the priority stack is:
>
> 1. **End-to-end walk loop on a real iPhone** (this is the MVP kernel).
> 2. **Architectural integrity** — no "we'll refactor later" debt.
> 3. **Alpha-grade product polish** — walkable-way snapping, custom map/game
>    styling, auth refresh, friends graph, leaderboards, web dashboard — built
>    on top of the same kernel.

### Current status

The living project handoff is `00-CURRENT-STATUS.md`.

ParkWalk is currently in the **Phase 1 first-walk loop** plus the first
recorded-walk Alpha slice: backend, iOS app, hosted Railway API, auth, nearby
collectibles, collect idempotency, movement validation, local recorded walks,
native iOS pedometer integration, route tracing, recovery, and walk history are
implemented enough for real iPhone testing. Cloud sync for recorded walks is
implemented locally but still requires the backend changes to be pushed and
deployed to Railway.

### Phase 1 P0 — finish the walk proof

- Verify Railway `/health` and `/ready`.
- Seed nearby collectibles with `NEARBY_AUTO_SEED_ENABLED=true` or the manual
  seed script.
- Complete one clean outdoor collect from the iPhone app.
- Verify stats and `user_collections` in the database.
- Save a real walking fixture for regression tests.

### Alpha P0 — native motion reliability

- Native iOS `CMPedometer` step backfill/streaming and recorded walk sessions
  with path tracing, pause/resume, auto-finish, recovery, walk detail, and local
  history are implemented and field-tested.
- Deploy the backend walk API and migration to Railway so completed local walks
  sync from `failed` to `synced`; see `15-WALK-RECORDING.md`.
- Defer optional HealthKit step/distance aggregation until native pedometer
  recording is proven.
- Keep the JS accelerometer step detector as fallback.
- Revisit soft flags once native steps are reliable.

### Alpha P1/P2 — product hardening

- Walkable-way snapping for seeded entities.
- Custom map styling and collectible graphics.
- Offline map tiles only if cellular reliability or custom map asset delivery
  makes them necessary.
- Friends graph, activity feed, leaderboards.
- Web dashboard for map management, moderation, stats, and activity review.

### Phase 2 — broader product surface

- Paid Apple Developer/TestFlight/external testers.
- Remote push notifications.
- Real-time WebSocket features if polling is no longer enough.
- Challenges + events engine.

## Platform Support

- **iOS**: Native app (React Native), current focus.
- **Android**: Dropped from the active roadmap.
- **Web**: Dashboard planned after the walk loop is proven.

## Tech Stack Summary

### Mobile

- React Native 0.73+
- Mapbox Maps SDK (@rnmapbox/maps)
- Sensor integration (GPS + JS accelerometer today; native pedometer next)
- Zustand (state management)
- React Query (API & caching)

### Backend

- Node.js + TypeScript
- Express (REST API)
- PostgreSQL 15+ with PostGIS
- Redis (caching & sessions)
- Prisma ORM

### Planned Web Dashboard

- React + TypeScript
- Mapbox GL JS
- WebSocket client if real-time features are needed
- Recharts (analytics)
- Tailwind CSS

## Documentation Structure

```
docs/
├── README.md (this file)
├── 00-CURRENT-STATUS.md        # Living handoff + next phases
├── 01-ARCHITECTURE.md          # Architecture direction; marks planned areas
├── 02-DATABASE-SCHEMA.md       # Schema design; Prisma is source of truth
├── 03-API-SPECIFICATION.md     # REST contract notes; routers are source of truth
├── 04-SETUP-BACKEND.md         # Historical scaffold + local backend notes
├── 05-SETUP-MOBILE.md          # Historical mobile architecture sketch
├── 06-SETUP-WEB.md             # Future dashboard sketch
├── 07-MOVEMENT-DETECTION.md    # Movement validation algorithm
├── 08-GAME-ENTITIES.md         # Placement and entity system
├── 09-MAPBOX-INTEGRATION.md    # Mapbox style, graphics, and recenter behavior
├── 10-TESTING-STRATEGY.md      # Testing approach & tools
├── 11-DEPLOYMENT.md            # Future production deployment reference
├── 12-FIRST-WALK.md            # First end-to-end walk checklist
├── 13-BOOTSTRAP-IOS.md         # iOS bootstrap + field-test retros
├── 14-DEPLOY-RAILWAY.md        # Railway deploy (monorepo + PostGIS)
└── 15-WALK-RECORDING.md        # Start/End Walk, path trace, native steps plan
```

## Quick Start (Development)

### Prerequisites

- Node.js 20+ and npm 10+
- Xcode and an iPhone for the current iOS loop
- Mapbox `pk.*` runtime token and `sk.*` downloads token
- Hosted Railway backend URL
- Docker Desktop only for local backend integration tests

### 1. Install dependencies

```bash
npm install
```

### 2. Verify or deploy backend

Use `14-DEPLOY-RAILWAY.md`, then verify:

```bash
curl https://<railway-url>/health
curl https://<railway-url>/ready
```

### 3. Setup mobile app

```bash
cd mobile
cp .env.example .env
# Set MAPBOX_ACCESS_TOKEN=pk...
cd ios && pod install && cd ..
# Open ios/ParkWalk.xcworkspace in Xcode and run on device.
```

## Development Workflow

1. **Backend First**: Set up API endpoints and database
2. **Mobile Core**: Implement movement detection and map
3. **Game Mechanics**: Build collectibles system
4. **Web Dashboard**: Create management interface
5. **Integration**: Connect all components
6. **Testing**: Validate movement detection accuracy
7. **Polish**: UI/UX refinement

## MVP + Alpha Development Timeline

- **Done**: backend infrastructure, shared schemas, iOS bootstrap, hosted API
  default, auth refresh/logout, nearby auto-seeding, collect idempotency,
  movement soft-flag validation, first field-test fixes, and Mapbox Tilequery
  walkable-way snapping for generated collectibles.
- **Now**: confirm recorded-walk backend sync and keep field-testing snapped
  collectible placement across more walking routes.
- **Next**: DB verification for synced walks and collections linked to walks;
  then HealthKit and custom map/game visuals.
- **Later Alpha**: friends/activity, leaderboards, web dashboard, hardening.
- **Phase 2**: external distribution, push, real-time features, challenges/events.

## Key Decisions & Rationale

### Why React Native?

- Strong iOS iteration speed with a native shell where needed
- Good sensor access via native modules
- Fast iteration for MVP
- Can optimize with native code later if needed

### Why Mapbox?

- Complete style customization (game-like aesthetics)
- Excellent mobile performance
- Used by similar apps (Pokémon GO, Strava)
- Free tier sufficient for MVP (50k map loads/month)

### Why PostgreSQL + PostGIS?

- PostGIS provides efficient geospatial queries
- Critical for "find nearby treasures" functionality
- Better than NoSQL for complex spatial relationships
- Mature ecosystem

### Why Movement Detection Focus?

- Core differentiator from simple map apps
- Prevents cheating (driving to collect items)
- Enables fair leaderboards
- Foundation for future fitness features

## Next Steps

1. Read `00-CURRENT-STATUS.md` for the current handoff.
2. Follow `12-FIRST-WALK.md` for the next field test.
3. Review `15-WALK-RECORDING.md` before implementing recorded walks/native
   steps.
4. Review `07-MOVEMENT-DETECTION.md` before changing validation.
5. Use `14-DEPLOY-RAILWAY.md` for hosted backend work.

## Support & Resources

- [Mapbox Documentation](https://docs.mapbox.com)
- [React Native Documentation](https://reactnative.dev)
- [PostGIS Documentation](https://postgis.net)
- [Prisma Documentation](https://www.prisma.io/docs)

## License

[Your License Here]
