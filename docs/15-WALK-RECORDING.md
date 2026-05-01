# Walk Recording + Native Steps Plan

## Executive Summary

This document plans the next major ParkWalk capability: profile-backed recorded
walks with reliable native step count, visible route tracing, offline-first
recording, and cloud sync.

The product goals are:

1. The user presses **Start Walk**.
2. ParkWalk records steps, path, elapsed time, and distance.
3. The user sees the walked path on the map while walking.
4. The user sees live time, distance, and step count.
5. The user can **Pause**, **Resume**, and **End Walk**.
6. The walk continues while the app is backgrounded or the screen is locked.
7. If the user forgets to end the walk, ParkWalk can finish it safely after a
   conservative inactivity window.
8. Completed walks are available under the user's profile, both offline and
   synced to the cloud when connectivity allows.
9. Collecting items requires an active walk.

This is no longer a local-only Alpha experiment. It is a core profile/history
feature and a future input to notifications, stats, social signals, and
leaderboards.

## CTO Review

Recorded walks should become a first-class ParkWalk domain object.

The feature sits at the intersection of product identity, anti-cheat,
notifications, stats, and privacy. That means the architecture must be stronger
than a UI-only route line. A walk must have durable identity, local-first state,
cloud sync, and an explicit relationship to collections.

Key principles:

- **Walks are first-class**: collecting is no longer the root activity; a walk is
  the root activity, and collections happen inside it.
- **Offline-first, cloud-backed**: the user can record on cellular drops or poor
  coverage; the backend eventually receives the completed record.
- **Profile-owned history**: completed walks belong under the user's profile and
  feed stats/notifications.
- **Native step source first**: use iOS `CMPedometer`; keep the JS accelerometer
  detector as fallback only.
- **Background capable**: the system must support screen-locked walks.
- **Conservative auto-finish**: solve forgotten End Walk without ending normal
  walks during pauses, traffic lights, or stops.
- **Precise paths are sensitive**: even if Alpha accepts cloud path storage,
  route data must be modeled as private user data from day one.

## Architecture Decisions Locked For This Plan

- Collecting requires an active, non-paused walk.
- Walks are saved locally first and synced to the cloud, so a user can record
  through poor connectivity and still see the completed walk under their
  profile after sync.
- Full GPS paths may be stored in the cloud database during Alpha.
- Pause/resume is part of V1.
- Pause/resume route rendering must preserve separate walked segments. ParkWalk
  must not draw a connecting line through a pause gap if the user resumes from a
  different location.
- Auto-finish is part of V1, using conservative inactivity rules.
- Background and screen-lock recording are required.
- Walk data should become a foundation for profile stats, streaks, later
  notifications, and social/activity features.
- Each completed walk should open into a detail screen with the route and walk
  stats.
- Paused time should be shown separately from moving time.
- "No collect without active walk" should be enforced in both the client and the
  backend from the first implementation slice that introduces walk sessions.

## Product Requirements

### Required In V1

- Start Walk / Pause / Resume / End Walk controls.
- One active walk per user/device at a time.
- Collectibles can only be collected during an active, non-paused walk.
- Live route line on the map.
- Live route line is rendered as one or more route segments, with visual gaps
  across paused time.
- Live elapsed moving/total time.
- Live distance.
- Live step count from `CMPedometer`.
- Background/screen-lock recording.
- Conservative auto-finish if the user forgets to end.
- Local durable storage of active and completed walks.
- Cloud sync of completed walk summaries and full path data.
- Walk history available under the user's profile.
- Walk detail screen with route and summary stats for each completed walk.
- Walk-linked collections.

### Implementation Status

Initial implementation has started:

- Shared walk schemas and collect `walkSessionId` contract exist.
- Backend `walk_sessions` persistence, list/detail endpoints, idempotent sync,
  and collection-to-walk client id linking exist.
- Mobile Start/Pause/Resume/End controls, local durable active session storage,
  route tracing, auto-finish prompt/timeout, unfinished-walk recovery panel,
  walk sync queue, walk history, and walk detail route/stat views exist.
- iOS `CMPedometer` bridge exists and feeds native step updates into the active
  walk session when available.

The first stabilization pass has now been implemented and field-tested on
iPhone:

1. Start/Pause/Resume/End controls remain responsive during live pedometer
   updates.
2. End Walk is local-first; final native step backfill and cloud sync run after
   the local completed walk is saved.
3. Active-session persistence is throttled; `AsyncStorage` is not written on
   every GPS/pedometer update.
4. Native steps are pause-aware by recording active pedometer windows and
   querying/summing only those windows at End Walk.
5. Native step increases update `lastMovementAt`, preventing weak-GPS false
   auto-finish.
6. The unfinished-walk Alert was replaced by an on-map recovery panel with
   Save Walk / Discard.
7. Field diagnostics are collapsible and stay out of the recovery controls.
8. Local walk storage is scoped by authenticated user.
9. The map panel shows moving time; paused time is tracked separately.
10. End Walk opens the local Walk Detail screen immediately.
11. Walk History exposes sync failure messages under failed rows.

Latest route-segmentation update:

1. The shared walk contract now stores `pathSegments` instead of one continuous
   `path` array.
2. Mobile local walk storage was bumped from `parkwalk.walk_sessions.v2` to
   `parkwalk.walk_sessions.v3`. Previous Alpha walk history is intentionally
   discarded on hydrate for this schema reset.
3. Start Walk opens the first segment. Pause closes the current segment. Resume
   opens a new segment seeded with the current location when available.
4. Active and detail maps render a Mapbox `MultiLineString`, so a pause/resume
   gap is not displayed as walked distance.
5. Backend storage moved from `path_geojson` to `path_segments` JSONB. Migration
   `20260501000000_walk_path_segments` clears old `walk_sessions` rows and
   detaches old collection rows from those walk ids during Alpha.

Still needs validation after deployment:

- Railway migration/deploy validation for `20260428000000_walk_sessions` and
  `20260501000000_walk_path_segments`.
- Hosted `POST /api/v1/walks`, `GET /api/v1/walks`, and `GET
  /api/v1/walks/:id` routes.
- Existing on-device `failed` walk sync rows should retry to `synced` after
  Railway deploys the walk API. Current expected pre-deploy error is `Route not
  found: POST /api/v1/walks`.
- Offline completed-walk sync retry test.
- Stats reset/reconciliation cleanup from the architecture review.

### Not Required In V1

- Public route sharing.
- Friends viewing another user's walk path.
- Apple Watch/HealthKit aggregation.
- Multi-device conflict resolution beyond one active local recording device.
- Real-time notifications to other users while the walk is in progress.
- Public or social walk-detail views.

## User Experience

### No Active Walk

- Show **Start Walk**.
- Show nearby collectibles as visible world objects if useful, but tapping to
  collect should explain: "Start a walk to collect."
- User location and recenter behavior remain unchanged.

### Active Walk

- Show compact product metrics:
  - elapsed time
  - distance
  - steps
- Show controls:
  - **Pause**
  - **End**
- Draw the route line over Mapbox.
- Allow collecting items.
- Associate successful collections with the active walk.
- Persist route/step snapshots periodically, not on every sensor event, so the
  JS thread stays responsive while walking.

### Paused Walk

- Show paused state.
- Show **Resume** and **End**.
- Stop adding distance/path points while paused.
- Continue preserving the existing route.
- Close the current path segment on Pause and start a new segment on Resume.
  The Walk Detail map should show both segments but leave a gap between them.
- Stop the live pedometer subscription while paused.
- Record active pedometer intervals so final step totals exclude paused windows.

### End Walk

- Immediately move the active walk into completed local state so the UI and
  navigation remain responsive.
- Backfill final steps from `CMPedometer.queryPedometerData` in the background,
  with a timeout/fallback to the live count.
- Finalize distance/duration locally first.
- Show summary:
  - total duration
  - moving duration
  - paused duration
  - distance
  - steps
  - collected count
- Save locally.
- Queue cloud sync if offline.
- Sync after local completion; do not block End Walk on network availability.

### Auto-Finish

The user wants a safety net if they forget **End Walk**. The first version
should use a conservative two-stage design:

1. **Inactive prompt** after a short sustained stop, if the app is foregrounded:
   - 3 minutes stationary
   - minimal GPS displacement
   - no step growth
   - movement state stationary/unknown
   - UI asks: "Still walking?" with **Resume** / **End Walk**
2. **Auto-finish** after a longer sustained stop:
   - 6 minutes stationary
   - no step growth from pedometer backfill
   - no meaningful location displacement
   - finish at the last credible movement timestamp, not at the later timeout

This avoids counting the user sitting at home for an hour because they forgot
to tap End, while avoiding false stops during normal short pauses.

## Client Architecture

### Domain Model

```ts
type WalkSessionStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'auto_completed'
  | 'discarded'
  | 'sync_pending'
  | 'sync_failed'
  | 'synced';

interface WalkPathPoint {
  id: string;
  walkSessionId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  recordedAt: string;
  movementState?: MovementState;
  stepCountTotal?: number;
  source: 'gps' | 'best_fix';
}

interface WalkPauseInterval {
  startedAt: string;
  endedAt?: string;
}

interface WalkSession {
  id: string; // client-generated UUID, reused for backend idempotency
  serverId?: string;
  userId: string;
  status: WalkSessionStatus;
  startedAt: string;
  endedAt?: string;
  autoEndedAt?: string;
  pauseIntervals: WalkPauseInterval[];
  path: WalkPathPoint[];
  distanceMeters: number;
  stepCount: number;
  durationSeconds: number;
  movingDurationSeconds: number;
  collectedEntityIds: string[];
  syncState: 'local_only' | 'pending' | 'syncing' | 'synced' | 'failed';
  syncError?: string;
}
```

### Modules

Recommended ownership:

- `mobile/src/native/Pedometer`
  - Native iOS `CMPedometer` bridge.
- `mobile/src/services/walksApi.ts`
  - Upload completed walk summaries and paths.
  - Fetch profile walk history.
- `mobile/src/stores/walkSessionStore.ts`
  - Active/completed walk state.
  - Local persistence.
  - Start/pause/resume/end/discard actions.
  - Sync state.
- `mobile/src/hooks/useWalkSession.ts`
  - Coordinates GPS updates, native pedometer updates, path filtering, distance
    calculation, and auto-finish policy.
- `mobile/src/screens/MapScreen.tsx`
  - Renders Start/Pause/Resume/End controls, metrics, and route line.
- `mobile/src/screens/Profile/WalkHistory` or similar later
  - Reads synced/local completed walks.

### Local Persistence

Use local durable storage for the active walk and completed unsynced walks.
AsyncStorage can work for the first implementation if paths are modest, but it
is not ideal for large route histories.

Architectural recommendation:

- V1 can start with AsyncStorage for one active walk plus recent completed
  summaries.
- Storage must be scoped by authenticated user so an unfinished walk from one
  account cannot appear under another account.
- Move to SQLite/WatermelonDB/Realm if path volume grows or offline history
  becomes central.

Do not keep the active walk only in React state. A crash, battery death, or app
restart should not silently lose the walk.

### Route Rendering

Use Mapbox:

- `ShapeSource` with a GeoJSON `LineString`.
- `LineLayer` for the walked path.

The source updates from the active session path. The route line should be
visually clear but not obscure markers or roads.

### Distance Calculation

Distance should be calculated from accepted path segments, not every GPS point.

Initial filters:

- Ignore points with no coordinate.
- Ignore points with poor accuracy, initially `accuracy > 50m`.
- Ignore segments shorter than 1-2 meters to reduce jitter.
- Ignore segments with impossible implied speed unless movement validation later
  accepts them.
- Do not accumulate distance while paused.

Store enough raw-ish point data to debug later, but use filtered accepted
segments for user-visible distance.

## Native Pedometer Plan

### iOS Native Module

Use `CMPedometer` as the first reliable step source.

Required JS API:

```ts
interface NativePedometerModule {
  isStepCountingAvailable(): Promise<boolean>;
  getAuthorizationStatus(): Promise<
    'notDetermined' | 'restricted' | 'denied' | 'authorized' | 'unknown'
  >;
  querySteps(
    fromIso: string,
    toIso: string,
  ): Promise<{
    steps: number;
    distanceMeters?: number;
    startDate: string;
    endDate: string;
  }>;
  startUpdates(fromIso: string): void;
  stopUpdates(): void;
}
```

Events emitted to JS:

```ts
interface PedometerUpdate {
  startDate: string;
  endDate: string;
  steps: number;
  distanceMeters?: number;
  currentPaceSecondsPerMeter?: number;
  currentCadenceStepsPerSecond?: number;
}
```

### How Recording Uses It

On **Start Walk**:

- Create a local `WalkSession`.
- Persist it immediately.
- Start high-accuracy/background-capable location tracking.
- Call `CMPedometer.startPedometerUpdates(from: startedAt)`.

During active walk:

- Update live total steps from pedometer events.
- Append accepted GPS points.
- Recompute distance from accepted segments.
- Persist snapshots periodically, not every render.

On **Pause**:

- Record pause interval start.
- Stop accumulating path/distance.
- Decide whether to keep or stop pedometer live updates; final totals should
  exclude paused intervals.

On **Resume**:

- Close pause interval.
- Resume distance/path accumulation.

On **End Walk**:

- Call `stopPedometerUpdates`.
- Query `queryPedometerData(from: startedAt, to: endedAt)` and subtract paused
  intervals if needed.
- Store final step count and distance.
- Mark session completed.
- Queue sync.

Backfill matters. If JS misses an event while backgrounded, the final summary
can still use the system pedometer total for the session window.

## Background Recording

Requirement: recording must continue while the app is backgrounded or the
screen locks.

Design implications:

- Keep iOS Background Modes → Location updates enabled.
- Use location updates as the app's background execution anchor.
- Use `CMPedometer` backfill to recover steps even if JS event delivery pauses.
- Persist the active session frequently enough that a crash/restart can recover.
- On app resume, reconcile:
  - latest persisted session
  - pedometer query from last known timestamp to now
  - latest location fixes
  - auto-finish policy

Important limit: "background" and "terminated" are different. V1 should support
background/screen-lock recording while iOS allows location updates. It should
not promise perfect recording after the user force-quits the app or iOS
terminates it under pressure.

## Backend Architecture

Completed walks should sync to the backend and live under the user's profile.
Railway can support this through the existing hosted PostgreSQL/PostGIS
database. Railway is the hosting/deployment platform; the durable walk data
belongs in Postgres/PostGIS, not in the mobile build or Metro.

### Tables

Recommended Prisma model direction:

```prisma
model WalkSession {
  id                  String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  clientId            String    @unique @map("client_id") @db.Uuid
  userId              String    @map("user_id") @db.Uuid
  status              String    @db.VarChar(40)
  startedAt           DateTime  @map("started_at") @db.Timestamptz
  endedAt             DateTime? @map("ended_at") @db.Timestamptz
  durationSeconds     Int       @map("duration_seconds")
  movingDurationSeconds Int     @map("moving_duration_seconds")
  distanceMeters      Decimal   @map("distance_meters") @db.Decimal(10, 2)
  stepCount           Int       @map("step_count")
  collectedCount      Int       @default(0) @map("collected_count")
  autoFinished        Boolean   @default(false) @map("auto_finished")
  autoFinishReason    String?   @map("auto_finish_reason")
  pathPointCount      Int       @map("path_point_count")
  pathSegments        Json      @map("path_segments")
  pauseIntervals      Json?     @map("pause_intervals")
  createdAt           DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime  @updatedAt @map("updated_at") @db.Timestamptz
}
```

For Alpha V1, store full route segments as JSONB on the session. The shape is:

```ts
type WalkPathSegment = {
  startedAt: string;
  endedAt: string;
  points: WalkPathPoint[];
};
```

PostGIS `LineString`/`MultiLineString` can be added later if route analytics
become important.

Collections should gain a nullable `walk_session_id` so successful collect rows
can be tied to the active walk.

### API

Minimum endpoints:

- `POST /api/v1/walks`
  - idempotently creates/syncs a completed walk from a client-generated id.
- `GET /api/v1/walks`
  - lists the authenticated user's walks for profile/history.
- `GET /api/v1/walks/:id`
  - returns one authenticated user's walk, including path if requested.
- `PATCH /api/v1/collections/:id` or collect payload extension
  - associate collect with active walk, preferably by including `walkSessionId`
    in the collect request.

### Sync Model

- Client generates walk UUID at Start Walk.
- Client stores all active data locally.
- On completion, client posts the summary/path to backend.
- If offline, keep `sync_pending`.
- Retry with backoff when connectivity returns.
- Server treats `clientId` as idempotency key.

## Profile, Stats, And Notifications

Recorded walks should feed:

- User profile walk history.
- Total distance / weekly distance / daily distance.
- Total steps / weekly steps / daily steps once stats schema supports it.
- Streaks.
- Future notifications:
  - friend completed a walk
  - user has not walked today
  - nearby friends/activity signals

Do not build notifications in the first implementation, but model the walk data
so notifications can be derived later.

Notification design should use server-side completed-walk facts, not live path
streaming. Good first notification inputs are: completed walk event, distance,
duration, step count, collected count, streak changes, and coarse city/area if
that is later approved. Do not expose full route paths to other users through
notifications.

## Interaction With Collectibles

Product decision: **collecting requires an active walk**.

Rules:

- If no active walk: marker tap explains "Start a walk to collect."
- If walk paused: marker tap explains "Resume your walk to collect."
- If active walk: collect proceeds through current movement and distance
  validation.
- Collect request includes `walkSessionId`.
- Backend records `walk_session_id` on `user_collections`.

This ties gameplay to walking intentionally and avoids "stationary tap farming."

## Auto-Finish Design

Requirement: if the user forgets to end a walk, ParkWalk should stop and record
it.

Recommended V1 policy:

### Signals

Use all available signals:

- Last accepted path point timestamp.
- GPS displacement over recent window.
- Average speed.
- Movement state.
- Pedometer step increase from `CMPedometer` backfill.
- App foreground/background status.

### Thresholds

Start conservative:

- Inactive prompt candidate: 3 minutes stationary.
- Auto-finish candidate: 6 minutes stationary.
- Stationary radius: 10 meters.
- Step delta: fewer than 5 steps over the candidate window.
- Speed: below 0.3 m/s over the window.

### Finish Timestamp

When auto-finishing, set `endedAt` to the **last credible movement timestamp**,
not the moment the timeout fires. This keeps duration and distance honest.

### UX

- If foregrounded: prompt before ending.
- If backgrounded: auto-finish silently after the long threshold, then show a
  summary next time the app opens.

This is intentionally stricter than a fitness tracker. ParkWalk is gameplay
first, so it should close forgotten sessions sooner than a pure workout app
would. If field testing shows false endings during normal stops, increase the
auto-finish threshold before changing the overall design.

## Force-Quit And Termination Recovery

Best V1 behavior: preserve the active session locally as recoverable, but do
not silently resume it after a force-quit or iOS termination.

On next launch:

- Detect the locally persisted unfinished walk.
- Query `CMPedometer` for the missing step window if possible.
- Use the last credible movement timestamp as the proposed end time.
- Show a stable recovery panel/screen rather than a transient system Alert:
  - **Save Walk**
  - **Discard Walk**

This is better than automatically discarding, because a force-quit can happen by
accident or because iOS terminates the app under pressure. It is also better
than silently resuming, because the app cannot guarantee continuous GPS/path
recording after termination. The recovered walk should be marked as
`recovered_after_termination` so future analytics can separate it from cleanly
ended walks.

## Privacy And Trust

Owner decision: cloud path storage is acceptable for Alpha.

Still, implementation should treat paths as private:

- Walk paths are visible only to the owning user by default.
- Do not expose another user's path through APIs.
- Do not send path data to notifications; notifications should use summary
  facts unless explicitly changed later.
- Add deletion later when walk history UI matures.

This protects future product optionality without blocking the current plan.

## Testing Strategy

### Unit Tests

- Walk session state transitions:
  - idle → active
  - active → paused
  - paused → active
  - active/paused → completed
  - active → auto_completed
- Distance accumulator filters jitter.
- Pause intervals exclude distance/steps from moving metrics.
- Paused duration is shown separately from moving duration.
- Step update reducer computes totals correctly.
- Sync queue marks pending/synced/failed correctly.
- Collect without active walk is blocked client-side.

### Backend Tests

- Authenticated user can sync completed walk.
- Sync is idempotent by `clientId`.
- User can list only their own walks.
- Walk path belongs only to owner.
- Collect request with active `walkSessionId` links collection to walk.
- Collect request without `walkSessionId` is rejected server-side.

### Device Field Tests

Use `ParkWalkRelease` with `FIELD_DEBUG_OVERLAY=true`.

1. Start Walk → walk 2 minutes → End Walk.
2. Confirm path line appears and follows route.
3. Confirm elapsed time increments.
4. Confirm step count increments.
5. Confirm distance is plausible.
6. Pause for 1 minute → Resume → confirm paused distance does not grow.
7. Lock screen / pocket phone → continue walking → confirm final step backfill.
8. Disable connectivity → End Walk → confirm local saved/sync pending.
9. Restore connectivity → confirm cloud sync.
10. Forget to End Walk → wait 3-minute prompt / 6-minute auto-finish threshold
    → confirm summary.

## Requirement Inconsistencies Resolved

- Collecting without Start Walk: **not allowed**.
- Local-only walk history: replaced with **offline-first local + cloud sync**.
- Full GPS path leaving phone: allowed for Alpha as private cloud user data.
- Pause/resume: included in V1.
- Auto-stop: included as conservative auto-finish after inactivity.
- Background/screen-lock recording: required in V1.
- HealthKit: still deferred; `CMPedometer` is the first native step source.

## Recommended Implementation Slices

### Slice 1 — Stabilize Local Walk Session

- Non-blocking Start/Pause/Resume/End actions.
- Throttled active-session persistence.
- Native-step movement updates `lastMovementAt`.
- Pause-aware final pedometer step backfill.
- Stable unfinished-walk recovery panel.
- Unit tests around pause intervals, native step movement, non-blocking End
  Walk, and unsynced walk retention.

Status: implemented locally on 2026-04-29. Automated mobile tests cover this
slice; the next step is an iPhone Release build and outdoor confirmation.

### Slice 2 — Backend Stats And Data Integrity

- Shared user stats helper for collect and walk sync.
- Daily/weekly reset logic based on the activity date.
- Re-sync delta reconciliation for walk distance/minutes.
- `walk_session_id` delete behavior migration and user-delete integration test.
- Walk request schema consistency refinements.

### Slice 3 — Route Trace + Collect Gating

- Path filtering and distance accumulator.
- Mapbox route line.
- Collect requires active, non-paused walk.
- Collect payload includes client walk id.

### Slice 4 — Cloud Sync + Profile History

- Backend `walk_sessions` table.
- Walk sync endpoints.
- Link collections to walk session.
- Profile walk list.
- Walk detail screen with route and summary stats.
- Offline sync queue.

### Slice 5 — Background + Auto-Finish Hardening

- Screen-lock/background field test.
- Resume reconciliation.
- Auto-finish policy and summary.
- Tests for inactivity thresholds.

This sequencing keeps each PR testable while still moving toward the complete
product requirement.

## Stabilization Test Plan

The first stabilization pass includes automated tests for:

- Native step increases update `lastMovementAt`.
- Live native steps are ignored while a walk is paused.
- The walk-session hook records each movement sample once; active-session state
  updates must not retrigger recording of the same sample.
- Native step updates do not write local storage for every pedometer event.
- Auto-finish prompt state is persisted through store actions.
- Paused windows are excluded from final pedometer step backfill.
- The map walk timer shows moving time and holds steady while paused; paused
  time is tracked separately.
- End Walk immediately clears the active walk and retains the completed walk
  locally before pedometer query or cloud sync completes.
- End Walk opens the completed walk detail screen from the local record; cloud
  sync continues in the background.
- Walk history rows expose sync failures with the underlying error message so
  field tests can distinguish backend, auth, timeout, and validation problems.
- Completed-session retention never drops unsynced walks when trimming local
  history.

Manual field-test checklist after the first pass:

1. Build `ParkWalkRelease` from Xcode and install on iPhone. **Passed.**
2. Start Walk; confirm moving time, distance, and steps update. **Passed.**
3. Open Stats, Walks, and Settings while the walk is active. **Passed.**
4. Pause; confirm distance and walk step total stop changing; moving time should
   hold steady while paused time increases separately. **Passed after latest
   fix.**
5. Resume; confirm step/distance updates continue. **Passed.**
6. End Walk; confirm controls disappear promptly and Walk Detail opens.
   **Passed after latest fix.**
7. Force-close during an active walk; reopen; confirm recovery panel buttons
   save/discard correctly. **Passed.**
8. Lock screen during a short walk; unlock; End Walk; confirm pedometer backfill
   is plausible. **Passed.**
9. Open Walks; confirm rows sync to backend. **Blocked until Railway deploys
   the walk API. Current pre-deploy error: `Route not found: POST
   /api/v1/walks`.**

When `FIELD_DEBUG_OVERLAY=true`, the diagnostics must stay collapsed while the
unfinished-walk recovery panel is visible. The recovery panel is the priority UI
and its Save Walk / Discard buttons must remain readable and tappable.

## Remaining Product Decisions

These are the remaining product/architecture choices to confirm before expanding
the walk feature beyond the local stabilization slice:

1. **Path storage format**: V1 recommendation is encoded polyline or JSONB on
   `walk_sessions`; PostGIS `LineString` can follow when route analytics become
   important.
2. **Recovery UX copy**: decide the exact wording for the unfinished-walk
   recovery screen.
3. **Walk detail scope**: decide whether V1 detail shows only summary + route,
   or also collected items along the route.
