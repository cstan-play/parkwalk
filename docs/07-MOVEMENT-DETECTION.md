# Movement Detection Algorithm

## Overview

The movement detection system is the **core differentiator** of this app. It prevents cheating by validating that users are genuinely walking (not driving, biking, or spoofing GPS), while staying honest about real-world sensor limits (pocketed phones, indoor GPS, iOS suspending raw accelerometer streams).

**Authoritative implementation**

- Shared types & constants: `shared/src/schemas/movement.ts`, `shared/src/constants.ts`
- Client hook & classifier: `mobile/src/hooks/useMovementDetection.ts`
- Client sensors: `mobile/src/sensors/productionSource.ts`, `mobile/src/sensors/stepDetector.ts`, `mobile/src/sensors/pickBestFix.ts`
- Map / collect UX: `mobile/src/screens/MapScreen.tsx`
- Server validator: `backend/src/modules/movement/movement.service.ts`
- Collect transaction (distance + persistence): `backend/src/modules/entities/entities.service.ts`, `backend/src/modules/entities/entities.repository.ts`

## Signal priority (Phase 1, post–field retro)

The three signals are **not** equal partners in the classifier. They are ranked by trustworthiness on real hardware and by what the product is trying to prevent:

1. **GPS speed (primary).** Driving, biking, and being a passenger produce speeds above walking pace. The one permissible fast movement (running) is classified as `RUNNING`, not `WALKING_VALID`. GPS speed + max-speed-over-window is the authoritative anti-vehicle check and can stand on its own.
2. **Pedometer / step rate (secondary, corroborating).** When available, it boosts the validation score and feeds server-side soft flags (e.g. movement without steps). It is **not** required to enter `WALKING_VALID`, because iOS suspends the raw-accelerometer stream when the app backgrounds or the screen locks. The Alpha P0 upgrade is **CMPedometer (+ HealthKit)** via a native module (Pokémon GO Adventure Sync model); that will allow promoting steps toward harder gates. See `docs/13-BOOTSTRAP-IOS.md`.
3. **Activity recognition (tertiary, corroborating).** `CMMotionActivity` on iOS is not wired yet. Until then the `activity` field is often `UNKNOWN` and is treated as neutral for classification, not as proof of cheating.

### GPS accuracy threshold: 35 m (raised from 20 m)

`GPS_MAX_ACCURACY_METERS` is **35** in `shared/src/constants.ts`. Values above that push the **client** classifier toward `SUSPICIOUS`. On the server, average accuracy above 35 m is a **soft flag** (`LOW_GPS_ACCURACY`), not a hard reject, so legitimate urban/indoor walks are not blocked solely on noisy GPS.

The original 20 m figure appears in older design notes; real iPhone telemetry often reports 15–25 m horizontal accuracy even with high-accuracy modes outdoors.

### Known scope limit

A passenger in slow traffic (< 2.5 m/s for a full window, without automotive activity in samples) could clear the classifier today. Defence in depth:

- Server teleport check between GPS samples (hard reject).
- Server automotive activity on raw samples (hard reject if >30% of samples are `AUTOMOTIVE`).
- Sustained average speed above walking **with** `dominantActivity === 'AUTOMOTIVE'` (hard reject).

Native pedometer (Alpha P0) closes more of this gap.

## Soft-flag validation model (server)

`validateMovement(...)` returns `MovementValidationResult`:

```typescript
interface MovementValidationResult {
  valid: boolean;
  state: MovementState;
  score: number;
  reasons: string[]; // hard rejects: non-empty => valid === false
  flags: MovementFlag[]; // soft flags: persisted, do not block
}
```

### Hard rejects (block collect with **400** `MOVEMENT_INVALID`)

Collect fails when `valid === false`. Typical `reasons` today:

1. **No samples.** The request must include a non-empty `samples` array so the server can replay teleport / automotive checks. (The Zod schema still marks `samples` optional for forward compatibility; the validator enforces presence.)
2. **Sustained average speed > `MAX_WALKING_SPEED_MPS` and `dominantActivity === 'AUTOMOTIVE'`.**
3. **Teleport between samples:** gap distance > `TELEPORT_THRESHOLD_M` (50 m) **and** implied speed > 2× `MAX_WALKING_SPEED_MPS`.
4. **Future-dated summary:** `generatedAt` more than 5 s ahead of server receive time.
5. **>30% of samples** have `activity === 'AUTOMOTIVE'`.

### Soft flags (accept collect; persist evidence)

Persisted under `movement_data` / collection log; used for analytics and future anti-cheat triage:

| Flag | When |
|------|------|
| `LOW_GPS_ACCURACY` | `averageAccuracyMeters > GPS_MAX_ACCURACY_METERS` |
| `NO_STEPS_DURING_MOVEMENT` | Speed > 0.4 m/s but step rate < 0.3 Hz |
| `UNKNOWN_ACTIVITY` | Activity unknown/absent; also used for high cycling share in samples |
| `STALE_SUMMARY` | Summary older than 60 s on arrival |
| `CLIENT_STATE_NOT_WALKING` | Client summary state ≠ `WALKING_VALID` |
| `LOW_CLIENT_SCORE` | Client `validationScore < 0.5` |
| `FLAT_ACCELEROMETER_WITH_GPS` | GPS displacement with flat accel + almost no steps (spoof signature; soft until CMPedometer) |

### Spatial collect gate (PostGIS + uncertainty)

Raw `ST_Distance` from the user point to the entity is **not** the only rule.

- **`/entities/nearby`** still uses `ST_DWithin` with the query radius to **find** candidates. Returned rows **exclude** entities this user has already collected (`NOT EXISTS` on `user_collections`).
- **On collect**, the server computes `distance = ST_Distance(entity, user_point)` and reads `horizontalAccuracy` from `request.location.accuracy` (capped at **35 m**, same cap as `MAX_ACCURACY_TOLERANCE_M` in `entities.service.ts`).
  - **Effective distance:** `max(0, distance - tolerance)` must be ≤ `collection_radius_meters`.
  - **Hard limit:** if `distance > 2 × collection_radius_meters + tolerance`, reject with **400** `OUT_OF_RANGE` (stops “claim huge accuracy and collect from far away” abuse).

The mobile client mirrors this for tap gating: live haversine from the same fix sent in the collect body, with the same tolerance cap (`MapScreen.tsx`).

### Client GPS smoothing

`watchPosition` pushes fixes into a short ring buffer; each emitted `MovementSample` uses **`pickBestFix`**: among fixes received in the last **10 s**, pick the one with the **lowest** `horizontalAccuracy` (best fix). Reduces single-sample spikes when iOS briefly degrades accuracy.

## Classification states (shared schema)

`MovementState` in `shared/src/schemas/movement.ts`:

| State | Meaning |
|-------|---------|
| `UNKNOWN` | Insufficient or ambiguous data |
| `STATIONARY` | Very low speed and step rate |
| `WALKING_VALID` | Walking-like movement accepted by client classifier |
| `RUNNING` | Above walking speed threshold, not treated as driving |
| `VEHICLE_SUSPECTED` | Strong vehicle signal from speed / activity |
| `BIKE_SUSPECTED` | Cycling-like signal |
| `SUSPICIOUS` | e.g. poor GPS accuracy on client |
| `INVALID` | Reserved |

## MovementSample (wire format)

Authoritative shape: `movementSampleSchema` in `shared/src/schemas/movement.ts`. Conceptually:

- `timestamp` (ISO-8601 with offset)
- `location`: `latitude`, `longitude`, optional `accuracy` (meters), optional `altitude`
- `speedMps` (nullable)
- `headingDegrees` (optional)
- `acceleration` `{ x, y, z }` (optional)
- `stepCountDelta` (optional, integer)
- `activity` (optional enum: `STILL`, `WALKING`, `RUNNING`, `CYCLING`, `AUTOMOTIVE`, `UNKNOWN`)

## MovementSummary (client → server)

Rolling-window summary: `movementSummarySchema` — includes `windowSeconds`, `sampleCount`, `state`, speed stats, `averageAccuracyMeters`, optional `stepRateHz`, `dominantActivity`, `validationScore`, `generatedAt`.

## Tuning parameters

Single source of truth: `shared/src/constants.ts` (e.g. `MAX_WALKING_SPEED_MPS`, `GPS_MAX_ACCURACY_METERS`, `TELEPORT_THRESHOLD_M`, `MOVEMENT_WINDOW_SECONDS`, `MIN_SAMPLES_FOR_VALIDATION`).

Backend caps accuracy tolerance for collect at **35 m** in `entities.service.ts` (`MAX_ACCURACY_TOLERANCE_M`); keep in sync with product expectations for indoor play.

## Testing

- Server: `backend/test/movement.test.ts` — `validateMovement` contract.
- Client classifier: `mobile/src/hooks/useMovementDetection.test.ts` (when run with a working Jest resolver for `@parkwalk/shared`).
- Step detector: `mobile/src/sensors/stepDetector.test.ts`.
- GPS smoother: `mobile/src/sensors/pickBestFix.test.ts`.
- Haversine (UI distance): `mobile/src/util/geo.test.ts`.

## Known limitations

1. **Treadmills / indoor drift:** GPS may be poor; uncertainty-aware collect and soft flags reduce false negatives but do not replace outdoor truth.
2. **Activity recognition lag:** not yet integrated on iOS.
3. **Battery:** continuous location + sensors; optimize in production.

## Future improvements

- Native **CMPedometer** / **HealthKit** (Alpha P0) — see `docs/13-BOOTSTRAP-IOS.md`.
- Optional ML / barometer / user calibration — out of scope for current Phase 1 kernel.
