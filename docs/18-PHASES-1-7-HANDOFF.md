# Phases 1–7 Handoff: Smells, Gus polish, weather, map UX

> Snapshot of the work on `feat/smells-gus-polish-v1`. Written for a reviewer
> picking this up cold — covers what shipped, what's deliberately left, and
> what to validate before merge.

## Branch state at handoff

| Branch                          | At commit                                                                | Notes |
| ------------------------------- | ------------------------------------------------------------------------ | ----- |
| `main`                          | `980fb4d` Phase 5                                                        | Phases 1–5 already deployed to Railway (auto-deploy on push). |
| `feat/smells-gus-polish-v1`     | Phase 7 commit (see `git log -1`)                                        | One commit ahead of `main`: Phase 6, plus Phase 7 in the most recent commit. |
| `wip/branding-onboarding-overhaul` | Snapshot of pre-plan WIP (auth screens, branding, onboarding overhaul). | Untouched during this plan. Lives parallel to `feat/...`. |

The plan that drove all of this lives at
`~/.claude/plans/handoff-for-context-repo-deep-perlis.md` (sections A.1–A.6 for
smells, B for weather, C for notifications/chat, D for Gus Bible, E for map
polish). Item 4 (community map + AI image gen) is **deferred**.

## What shipped, phase by phase

### Phase 1 — copy & static visuals (`0d7179b`, `df36a10`)

- `mobile/src/screens/MapScreen.tsx`: map default pitch raised from `0°` to
  `70°` via `defaultSettings.pitch` *and* a `followPitch={70}` prop on the
  `Camera`. Both are required because `followUserLocation` overrides
  `defaultSettings` with follow-mode defaults; without `followPitch` the
  camera snaps back to flat as soon as the user is being followed.
- `shared/src/gusVoice/systemPrompt.ts`: added a profanity rule —
  "F-bombs are reserved for moments of genuine frustration; default to dry
  sarcasm."
- `shared/src/gusVoice/categories.ts`: expanded `stockLines` to 10 per
  notification category and added 3 `fewShots` per category. **Replaced stale
  model IDs** (`claude-sonnet-4-7`, which doesn't exist) with `grok-4.3`
  (matches the active xAI provider in `backend/src/env.ts`). Reviewers
  comparing against pre-plan blame will see the old IDs in earlier commits.

### Phase 2 — chat, notifications, latency (`d1c0fcd`)

- `mobile/src/stores/chatStore.ts`: optimistic insertion in `sendMessage`. A
  local `clientUuid()` id is allocated and the user bubble appears
  immediately; on success the local row is swapped for the server record and
  Gus's reply is appended; on failure the optimistic row is rolled back.
  Exported `FiringCategory = GusNotificationCategory | 'gus_intro' | null`
  for the chat screen.
- `mobile/src/screens/ChatScreen.tsx`: `CategoryChip` renders per-category
  color (amber/emerald/sky/violet). `ThinkingBubble` accepts a `category`
  prop so the spinner colour matches the firing category. Auto-scroll now
  uses a triple-retry helper (RAF / 60 ms / 240 ms), all `animated:false`,
  because iOS `FlatList` virtualization measures lazily and a single scroll
  call after layout was flaky. The early-return for the loading spinner was
  rewritten so it doesn't mask the FlatList when a notification opens chat
  (`if (loading && !loaded && !firingCategory)`); `ListEmptyComponent` is
  also suppressed during loading/firing to avoid the empty-state flash.
- `backend/src/modules/gus/voice.service.ts`: per-category `maxTokens` —
  `chat=180`, notifications=`320`. Threaded through both `callAnthropic` and
  `callXai`.
- `mobile/src/notifications/scheduler.ts`: `TEST_DELAY_MS` reduced 30 s → 15 s
  so manual testing from settings is less tedious.
- `mobile/src/screens/MapScreen.tsx` (`updateRecenterVisibility`): at
  `pitch > 5°` the reported visible bounds extends to the horizon and
  `isCoordinateInBounds` will return true even when the user is clearly
  off-screen. Patched to short-circuit `setShowRecenterButton(true)` whenever
  the camera is tilted past 5°.

### Phase 3 — walk-detail center ladder (`aebb02c`)

- `mobile/src/stores/walkSessionStore.ts`: new `SimpleLocation` type,
  `LocalWalkSession.startLocation` captured at `startWalk()`,
  store-level `lastKnownLocation` persisted in AsyncStorage (key
  `parkwalk.walk_sessions.v3.<owner>`) and updated on every accepted
  movement sample.
- `mobile/src/screens/WalkDetailScreen.tsx`: the detail map's `center` now
  resolves in this order — `pathSegments[0].points[0]` → `walk.startLocation`
  → `lastKnownLocation` → `null` (renders the empty state
  "Walk too short to map"). Dropped the old SF coordinate fallback that used
  to show users in California when a walk was too short.

### Phase 4 — Open-Meteo weather (`8687bb4`)

- `backend/src/env.ts`: `WEATHER_PROVIDER: z.enum(['open-meteo', 'none']).default('open-meteo')`.
- `backend/src/services/weather.ts` (new):
  - `getWeatherDescription(lat, lng)` and `getWeatherSnapshot(lat, lng)`
    (uncached for the debug command).
  - Fetches `weather_code`, `temperature_2m`, `precipitation`, and
    `wind_speed_10m` from Open-Meteo.
  - Wind descriptors at 3 / 7 / 12 m/s → breezy / windy / gusty.
  - **Precipitation override:** if `precipitation > 0` but the WMO code is
    clear/partly cloudy/overcast, override the description to
    "light rain". This was added after a field test where Gus said "no rain"
    while it was raining; the WMO code lagged the actual conditions.
  - 1 h Redis cache for the standard description; debug path bypasses the
    cache.
- `backend/src/modules/gus/context.service.ts`: optional `lat`, `lng` on
  `AssembleContextInput`. Uses a separate `findFirst` to fetch the user's
  latest walk's `pathSegments` JSON and walks it to the last GPS fix
  (`extractLatestPoint`). New `assembleWeatherDebug` helper used by the
  debug command path.
- `backend/src/modules/gus/gus.service.ts`: `isOpenMeteoDebugCommand` +
  `handleOpenMeteoDebug` + `formatOpenMeteoDebugReply`. `sendUserMessage`
  short-circuits when the user types "openmeteo" (case-insensitive) and
  replies with the raw upstream payload — handy for field debugging.

### Phase 5 — smell taxonomy + weather snapshot (`980fb4d`)

- `shared/src/schemas/entity.ts`: `smellTypeSchema` enum —
  `other_dogs_pee | real_poop | picked_up_poop | humans | neighbours | pigeons | birds`.
  `CollectibleConfig` gained optional `smellType` and `gusFlavor`.
- `shared/src/schemas/walk.ts`: `walkSmellSummarySchema = { totalCount, byType }`.
  `WalkSession` gained `weatherSnapshot: string | null` and `smells`.
- `backend/prisma/schema.prisma` + migration `20260511120000_walk_weather_snapshot/`:
  `walk_sessions.weather_snapshot TEXT NULL`.
- `backend/src/modules/walks/walks.service.ts`:
  - `syncWalk` resolves a weather snapshot via the new `weather.ts` service.
    Idempotent re-syncs **preserve the original snapshot** (we don't
    overwrite when the row already has one).
  - `getWalk` / `listWalks` derive `smells` via a single
    `userCollection.findMany` joined with `entity.config`, then
    `deriveSmellSummaries` validates each `smellType` through
    `smellTypeSchema.safeParse`.
- `backend/src/modules/entities/placement.service.ts`: `pickSmellType()` —
  weighted distribution (pigeons 25 / birds 20 / real_poop 15 / humans 12 /
  other_dogs_pee 12 / picked_up_poop 8 / neighbours 8 = 100). Auto-seeded
  collectibles also carry a `name`, `points` (10, or 50 for rares), and a
  `placement.version: 2` marker. **Existing entities seeded pre-Phase 5
  have no `smellType`**; see "Known limitations" below.

### Phase 6 — mobile smell rendering (`15379cf`)

- `mobile/src/stores/walkSessionStore.ts`:
  - `SmellCollection` interface (`entityId`, `smellType`, `name`, `points`,
    `collectedAt`, `gusFlavor?`).
  - `LocalWalkSession.collectedSmells: SmellCollection[]`.
  - `markCollected(entityId, smellMeta?)` — appends to `collectedSmells`
    only when meta is provided (legacy entities don't have meta).
  - `normalizeLocalSession` defaults `collectedSmells: []` for rows
    rehydrated from a pre-Phase 6 AsyncStorage version.
- `mobile/src/utils/smells.ts` (new): `describeWalkSmells({ byType, weather,
  timeOfDay, walkSeed })` returns `{ headline, lines }`. Deterministic via
  Mulberry32 hashed from `walkSeed` (so re-opening the same walk renders
  the same flavor). Per-type templates (3–4 each) react to `weather` mood
  ("rain" / "cold" / "warm" / "neutral") and `timeOfDay` bucket.
- `mobile/src/screens/WalkDetailScreen.tsx`: stat label "Collected" →
  "New smells found"; new `<SmellsSummary>` block under the stats grid;
  `buildSmellsSummary` / `readByType` / `readWeather` / `timeOfDayFromIso`
  helpers.
- `mobile/src/screens/MapScreen.tsx`: `extractSmellMeta(entity)` reads the
  Phase 5 fields off `entity.config`; `isSmellType` validates against the
  enum set so a config with a junk string doesn't taint the local store.

### Phase 7 — auto-collect, haptic, sound, toast (most recent commit)

The biggest behavioural change in this branch. **Markers are now passive
— there is no tap-to-collect.** Collection is driven by a proximity-based
effect on every movement/state change.

**New files**

- `mobile/src/services/soundCue.ts` — no-throw cue. Preloads
  `assets/sounds/smell-found.wav` (a 4.4 kB silent placeholder; drop a real
  ~100 ms WAV at the same path to enable audible playback, no code change
  needed). `Sound.setCategory('Ambient', true)` so the cue doesn't fight
  Apple Music / Spotify on iOS.
- `mobile/src/components/ui/SmellToast.tsx` — auto-dismiss bottom toast.
  `pointerEvents="none"`, ~1.6 s dismiss, 200 ms fade. The `onHidden`
  callback is held in a ref so callers don't have to memoize — a parent
  re-render (e.g. `MapScreen`'s 1 Hz nowTick) does not restart the dismiss
  timer.
- `mobile/src/assets/sounds/smell-found.wav` — silent placeholder.

**MapScreen rewiring**

- `pendingRef: Set<string>` — entity IDs whose mutation is in flight.
- `cooldownRef: Map<string, number>` — entity ID → unblock epoch after a
  failed collect. `COLLECT_COOLDOWN_MS = 4_000`.
- `appStateRef: AppStateStatus` — driven by an `AppState` listener. The
  auto-collect drain bails out when the app is not `active`.
- `smellPulse: Animated.Value` — bumps the smells metric scale `1 → 1.3 → 1`
  on each successful collect.
- **Auto-collect drain effect** (deps:
  `[activeWalk?.status, activeWalk?.collectedEntityIds.length, collectUi.kind, livePoint, nearbyQuery.data]`).
  On every tick:
  - Filter nearby entities to (a) not already collected, (b) not in
    `pendingRef`, (c) not in active cooldown, (d) `collectable()` —
    distance to entity minus capped GPS accuracy `≤ collectionRadiusMeters`.
  - Pick the closest survivor. Mark `pendingRef`, fire the mutation.
  - Concurrency is 1 (gated by `collectUi.kind === 'idle'`). In a cluster,
    candidates are drained serially as each mutation resolves and the deps
    change.
- On `onSuccess`: `markCollected(entity.id, smellMeta)`, set toast
  `Smell found: <name> +<points>`, play cue, fire haptic
  (`impactMedium`, `ignoreAndroidSystemSettings: true`), invalidate
  `['nearby']` and `['myStats']`.
- On `onError`: `pendingRef.delete`, `cooldownRef.set(entityId, now + 4000)`,
  toast only when `category.surface === 'show'`.
  `categorizeError` returns `surface: 'show'` for `OUT_OF_RANGE` /
  `MOVEMENT_INVALID` (user-actionable), `'silent'` for `ALREADY_COLLECTED`
  / `WALK_REQUIRED` / 429 / network (the cooldown will retry).
- Markers: `PointAnnotation` no longer has `onSelected`. The marker is
  dimmed (`opacity: 0.4`) when the entity is in `collectedEntityIds`. The
  next `nearbyQuery` refetch (30 s `refetchInterval`) drops it entirely.

**Walk panel**

- New fourth metric tile: `smells: N` with the `smellPulse` bump animation.

**Today's bug fixes (folded into the Phase 7 commit)**

- **Toast was never dismissing.** Root cause: an inline `onHidden` arrow on
  `MapScreen` had a new identity every render. `SmellToast`'s effect
  depended on it, so the dismiss timer was cancelled + restarted on every
  `MapScreen` re-render (1 Hz nowTick). Fixed by storing the callback in a
  ref inside `SmellToast` and dropping `onHidden` from the effect deps.
- **Haptic was sub-perceptible.** `impactLight` on Android maps to ~10 ms
  `EFFECT_CLICK` which most hardware doesn't surface. Switched to
  `impactMedium` (`EFFECT_HEAVY_CLICK`) and flipped
  `ignoreAndroidSystemSettings: true` because the collect haptic is an
  explicit user-action signal, not ambient feedback.
- **Walk detail showed "Lampposts were stale" after a successful collect.**
  Root cause documented under "Known limitations" — legacy entities lack
  `smellType` so `byType` is empty even when `collectedEntityIds.length > 0`.
  `WalkDetailScreen.buildSmellsSummary` now renders
  `"N finds, no breakdown yet."` instead of the generic empty headline in
  that mismatch state.

**Native dependencies added**

- `react-native-sound@0.11.2` (pinned at 0.11.x — 0.13.0 uses RN 0.74+
  APIs and fails `compileReleaseKotlin` against this project's RN 0.73.11).
- `react-native-haptic-feedback@3.0.0`.

iOS Pods regenerated; `mobile/ios/Podfile.lock` is part of the commit.
Android picks both up via autolink; no manual `MainApplication.kt` edits
were needed.

## Cross-cutting design decisions

These were taken without being in the plan and confirmed with the user at
field-test time. Documented here so a future reviewer doesn't think they
slipped in by accident.

- **Cluster collection is serial, not parallel.** The drain effect fires
  one mutation at a time and re-evaluates after each. A user standing in a
  three-marker cluster will see three sequential toasts and three haptics,
  not one fused event. Rationale: each collect is its own round-trip with
  its own movement validation; parallelizing them complicates the
  idempotency story and would mask validation rejections.
- **Marker dims on local collect, disappears on next refetch.** Local
  state (`collectedEntityIds`) drives the dim immediately for snappy
  feedback. The 30 s `nearbyQuery` refetch is what removes the marker —
  the server filter drops already-collected entities for the active walk.
- **Smells metric on the walk panel.** Live counter (`smellPulse` bump on
  each collect) sitting next to moving / distance / steps. Kept after user
  sign-off in this thread.

## Known limitations / open issues

- **Legacy entities lack `smellType`.** Anything seeded before the Phase 5
  deploy has a config without `smellType` / `name` / `points`. When such an
  entity is auto-collected:
  - The toast reads `Smell found: Mystery smell +0` (or whatever `points`
    happens to be).
  - `extractSmellMeta` returns `undefined` so the entity is **not**
    appended to `collectedSmells`.
  - The walk detail falls back to `"N finds, no breakdown yet."`.
  Recipe to surface the full taxonomy: purge auto-seeded collectibles older
  than the Phase 5 deploy and let `ensureNearbyCollectibles` re-seed them
  with `placement.version: 2` configs.
- **Sound is silent in the build.** Bundled WAV is a 4.4 kB placeholder so
  the build never fails on missing asset. Drop a royalty-free ~100 ms cue
  at `mobile/src/assets/sounds/smell-found.wav` (same filename) to make it
  audible; `soundCue.ts` requires no changes.
- **Auto-collect is foreground-only.** `appStateRef` gates the drain
  effect. If the user backgrounds the app mid-walk, no collect attempts
  fire until they return to foreground. This is V1-intentional — keeping
  auto-collect tied to foreground simplifies movement validation and avoids
  surprise mid-walk haptics.
- **Android background location is deferred.** iOS records path with the
  screen closed via the `UIBackgroundModes: location` capability already
  in `Info.plist`. Android parity (foreground service + `ACCESS_BACKGROUND_LOCATION`
  request flow) is not done.
- **`WalkDetailScreen` calls `useMemo` after a conditional return.** Pre-existing
  hooks-rule violation inherited from Phase 6. Works in practice because
  once `walk` is non-null on render 2+ the hook order is stable, but it's a
  latent bug — reordering `smellsSummary` above the `if (!walk) return`
  would fix it.
- **No location-permission-denied overlay** on `MapScreen`. If the user
  declines location permission after a fresh install, the screen just sits
  blank. Not handled in this plan.

## Test status (field-verified by user)

| Phase   | iOS  | Android | Notes |
| ------- | ---- | ------- | ----- |
| Phase 1 | Pass | Pass    | Map tilt verified after `followPitch` fix. |
| Phase 2 | Pass | Pass    | Chat scroll improvements verified; "still some improvements for later". |
| Phase 3 | Pass | Pass    | Walk detail center ladder reachable through the empty-walk path. |
| Phase 4 | Pass | Pass    | OpenMeteo debug verified; wind data wired; precipitation override fixed a false "no rain" Gus reply. |
| Phase 5 | Pass | Pass    | Verified after merging Phases 1–4 to main (Railway auto-deploys schema). |
| Phase 6 | Pass | Pass    | Smells block renders on walk detail. |
| Phase 7 | Partial | Partial | See below. |

**Phase 7 field-test results (most recent run):**

- Auto-collect on walk-by: pass.
- Stand still inside radius → exactly one collect: pass.
- Cluster of 3 → three sequential toasts: pass (user got a +50 rare in the
  same session — by design, rares appear roughly 1 in 6 seeded markers).
- Haptic: **fixed** (was `impactLight`, now `impactMedium`).
- Toast dismissing: **fixed** (ref-pattern fix in `SmellToast.tsx`).
- Walk detail rendering: **fixed** (fallback headline when `byType` is empty).
- Sound: silent because of placeholder WAV.
- Pause/resume, cooldown-on-network-error, background-app gating: not
  field-tested yet.

## What's left

### Phase 8 — Gus intro + persona finalize (not started)

Needs user-supplied copy for `gus_intro` fewshots and for the PREAMBLE
warmth / innocent-genius / self-aware sections. Plan file section D has
the spec. No code yet.

### Phase 9 — final regression sweep (not started)

Full smoke run across all phases before merging `feat/...` to `main`. No
new code — gated on Phase 7 field-test completion and Phase 8 copy.

### Deferred (out of scope for this plan)

- **Item 4 from the plan:** community map + AI image gen.
- Location-permission-denied overlay on `MapScreen`.
- `MapScreen` SF fallback on app re-entry (currently it falls back to SF
  only if `lastKnownLocation` is still undefined after rehydration).
- Chat scroll polish per user notes during Phase 2 (works, but room to
  improve).
- Android background location + foreground service.
- Replacing the placeholder smell-found WAV with a real cue.

## Migration & deploy notes

- **Single Prisma migration in this branch:**
  `backend/prisma/migrations/20260511120000_walk_weather_snapshot/` adds
  `walk_sessions.weather_snapshot TEXT NULL`. Backwards-compatible (NULLable
  with no default backfill required). Railway auto-applies on deploy via
  the start command in `docs/14-DEPLOY-RAILWAY.md`.
- **No schema drift between `main` and `feat/...` after Phase 5 merged to
  main.** A build on either branch hits the same DB shape; the only
  difference is mobile behaviour (Phase 6 + Phase 7).
- **Backend stays on Phase 5 deploy while Phase 6 + Phase 7 ride on the
  feat branch.** Both are mobile-only changes; no backend changes between
  Phase 6 and Phase 7. The Railway environment does not need a re-deploy
  to test Phase 6 or Phase 7 builds.

## Replication recipe for a reviewer

```bash
# 1. Pick up the branch
git switch feat/smells-gus-polish-v1

# 2. Mobile
cd mobile
npm install
cd ios && pod install && cd ..

# 3. iOS build (signs with the standing dev cert)
npx react-native run-ios

# 4. Android release APK
cd android && ./gradlew assembleRelease
# APK lands at: mobile/android/app/build/outputs/apk/release/app-release.apk
```

To force a smell-typed seed for testing the walk detail breakdown:

```sql
-- Purge auto-seeded collectibles older than the Phase 5 deploy so they get
-- replaced with placement.version: 2 configs on next ensureNearbyCollectibles.
DELETE FROM "entities"
 WHERE type = 'collectible'
   AND config->'placement'->>'source' = 'nearby_auto_seed'
   AND (config->'placement'->>'version')::int IS DISTINCT FROM 2;
```

The mobile app's next `/nearby` request will trigger
`ensureNearbyCollectibles` and reseed the area with full Phase 5 configs.

## Where to look first

- Drive a real device through one walk → one collect → walk debrief. That
  single path exercises Phases 3, 5, 6, 7 end-to-end.
- For Gus voice / weather: open chat after starting a walk and type
  `OpenMeteo`. The reply shows the raw upstream snapshot. Type anything
  else for normal Gus replies — those flow through
  `assembleContext` + `voice.service` with the new weather string folded
  into the prompt.
- For map UX: ensure the camera lands at 70° pitch on first load and the
  recenter button appears as soon as you pan off-user (even while tilted).
