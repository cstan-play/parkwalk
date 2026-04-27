# First walk checklist

The goal of this walk is to prove end-to-end that:

1. Your iPhone (free-sideload) can hit the hosted Railway backend over HTTPS.
2. GPS streams in.
3. The client records recent walking samples while you approach a collectible.
4. The server accepts a collect after plausible recent walking and rejects
   impossible movement, vehicle movement, or out-of-range taps.
5. Stats increment.

If any of these fail, stop and fix before moving on. Phase 2 will be faster
if Phase 1 correctness is real.

## Step 0 — Preconditions

- [ ] Railway backend is deployed and public.
- [ ] `https://<railway-url>/health` returns `{"status":"ok",...}`.
- [ ] `https://<railway-url>/ready` returns `{"status":"ready",...}`.
- [ ] `mobile/.env` has a valid `pk.*` Mapbox token. Leave `API_BASE_URL`
      empty for the default production Railway API, or set it to another
      hosted HTTPS Railway/staging URL.
- [ ] Xcode project is signed with your Personal Team, Background Modes
      capability has **Location updates** checked.
- [ ] You know where you will verify the result: Railway logs, database query
      tool, Railway CLI, or Prisma Studio connected to the Railway database.

## Step 1 — Verify hosted services

From any browser or terminal:

```bash
curl https://<railway-url>/health
# {"status":"ok","uptimeSeconds":...}
curl https://<railway-url>/ready
# {"status":"ready","db":"ok","redis":"ok"}
```

From your iPhone, open Safari and visit:

```
https://<railway-url>/health
```

You should see the same JSON. If not, fix Railway deploy/networking before
testing the app.

## Step 2 — Build and install on iPhone

```bash
# Terminal 1 (Metro)
cd mobile && npm start

# Xcode: Product → Run
```

Wait ~30-60 seconds for first build. App opens on phone.

First launch prompts:

- "Allow ParkWalk to use your location" → **Always Allow** (for
  background GPS during walks).
- "Allow ParkWalk to access motion and fitness" → Allow.

## Step 3 — Register an account

In the app: Onboarding → Create account.

- Username: any (e.g. `walktester`).
- Email: any real format (not verified in Phase 1).
- Password: 8+ chars.

Check Railway logs — you should see a registration request.

## Step 4 — Seed entities near where you will walk

Recommended for ad-hoc testing: enable nearby auto-seeding on Railway:

```env
NEARBY_AUTO_SEED_ENABLED=true
NEARBY_AUTO_SEED_TARGET_COUNT=12
NEARBY_AUTO_SEED_RADIUS_METERS=140
NEARBY_AUTO_SEED_MIN_DISTANCE_METERS=25
NEARBY_AUTO_SEED_MIN_SPACING_METERS=18
```

Restart/redeploy the Railway service after changing variables. The next
authenticated `/api/v1/entities/nearby` call will top up a small shared
cluster around the phone's reported location.

Alternative: use `docs/14-DEPLOY-RAILWAY.md` Step 10 to run
`prisma:seed` as a Railway one-off command after setting
`SEED_CENTER_LAT / SEED_CENTER_LNG`.

## Step 5 — The actual walk

- Put on shoes.
- Leave the app in the foreground and start walking outside when you can
  (GPS indoors on a campus can work but expect ±15–40 m accuracy; the app
  uses uncertainty-aware distance for collects).
- There is currently no on-map debug overlay. Let GPS settle for roughly
  15 seconds before testing a collect.
- If you pan away and your blue location dot is no longer visible, a round
  lower-right recenter button should appear. Tap it to fly the map back to your
  current location and resume follow mode.
- As you approach a seeded collectible, its marker should appear and you
  can **tap the marker** to collect (there is no separate collect button).
- The client uses live GPS distance plus capped horizontal accuracy for the
  local "Too far" check. The backend re-validates with the same uncertainty-aware
  distance rule.
- Tap → collect → success alert → `+N points`. The marker should **disappear**
  on the next nearby refetch (up to ~30 s) because the API excludes entities
  you already collected.

## Step 6 — Verify on the server

Use Railway's database query tool, Railway CLI, or Prisma Studio connected to
the Railway `DATABASE_URL`.

You should see your user with `all_time_score >= 10` and
`total_collections >= 1`.

Useful checks:

```sql
SELECT u.username, s.all_time_score, s.total_collections
FROM users u
JOIN user_stats s ON s.user_id = u.id;

SELECT id, movement_validated, movement_state, points_earned, distance_from_entity_meters
FROM user_collections
ORDER BY collected_at DESC
LIMIT 5;
```

`movement_validated` must be `t` (true) and `movement_state` must be
`WALKING_VALID`.

## Step 7 — Adversarial tests (this is the proof of the USP)

### Stationary / low-motion collect

- Sit still indoors with the app open for 30 seconds next to a marker you
  have not collected.
- Try to collect while still.
- **Current behavior:** the map does **not** gate collects on
  `WALKING_VALID` — taps still reach the server if you are within the
  uncertainty-aware radius and movement validation passes (samples present,
  no teleport/vehicle hard rejects). The server may record soft flags such as
  `CLIENT_STATE_NOT_WALKING` or `NO_STEPS_DURING_MOVEMENT`. Tightening this
  (require walking state or steps for collect) is a product decision, not
  implemented today.

### Vehicle reject

- Get a friend to drive you past a seeded collectible.
- Or seed an entity along a bus route and ride the bus.
- Try to collect.
- Expected: backend responds 400 `MOVEMENT_INVALID`, reasons include
  speed/vehicle.

### Teleport reject (optional, requires a GPS spoof)

- Use Xcode → Simulate Location to jump your location 500m.
- Try to collect.
- Expected: backend rejects with teleport / spoof reason.

## Step 8 — Record fixtures from a real walk

After a successful walk, pull the `movement_data` JSONB of a collection row
and save it as `backend/test/fixtures/real-walking-<date>.json`. Future
regressions can compare against real data, not synthetic.

## If something fails

- **Registration / login: "Network error" or timeout**: confirm the Settings
  screen shows an `https://` Railway URL, then open `/health` from iPhone
  Safari. If Railway is reachable in Safari but not the app, rebuild after
  editing `mobile/.env`.
- **Map loads but collect says there is no movement summary**: GPS has no
  samples yet. Walk outdoors with open sky. If still stuck, check that location
  permission is `Always` and motion is `Allowed`.
- **Tap says "Too far" while the dot looks close**: stale map perception vs
  true fix, or GPS uncertainty. Walk a few meters; if it persists, compare with
  `docs/07-MOVEMENT-DETECTION.md` (uncertainty-aware collect).
- **Collect returns 400 MOVEMENT_INVALID while walking**: compare the
  rejected summary with `walking.json` fixture. Most common causes: GPS
  accuracy too poor (urban canyon), or step count delta too low (holding
  phone very still). Log the summary; tune constants in
  `shared/src/constants.ts` if the real-world floor/ceiling differ from
  synthetic.
- **Collect returns 409 ALREADY_COLLECTED**: you already have that
  collectible. Walk to a different one.

## After This Walk

- If the collect succeeds, save a real movement fixture and move to the Alpha P0
  native pedometer/HealthKit milestone in `00-CURRENT-STATUS.md`.
- If a friend needs to test or free signing becomes too painful, enroll in the
  Apple Developer Program and set up TestFlight.
- If the walk loop is stable and social/product work becomes the priority,
  start the friends/activity/leaderboard/dashboard slice.
