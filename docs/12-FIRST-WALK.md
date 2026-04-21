# First walk checklist

The goal of this walk is to prove end-to-end that:

1. Your iPhone (free-sideload) can hit your local backend.
2. GPS streams in.
3. The client classifies movement as `WALKING_VALID` when you're actually
   walking.
4. The server accepts the collect and rejects anything suspicious.
5. Stats increment.

If any of these fail, stop and fix before moving on. Phase 2 will be faster
if Phase 1 correctness is real.

## Step 0 — Preconditions

- [ ] Mac on the same Wi-Fi as the iPhone.
- [ ] `mobile/.env` has `API_BASE_URL=http://<mac-lan-ip>:3000` and a valid
      `pk.*` Mapbox token.
- [ ] `backend/.env` is filled; `JWT_SECRET` is at least 32 characters.
- [ ] Xcode project is signed with your Personal Team, Background Modes
      capability has **Location updates** checked.

## Step 1 — Bring up services

```bash
# Terminal 1 (repo root)
npm run infra:up

# Terminal 2 (backend)
cd backend
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

You should see:

```
ParkWalk backend ready. Bind 0.0.0.0 so your iPhone on LAN can reach it.
```

## Step 2 — Verify reachability

From your Mac:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok","uptimeSeconds":...}
curl http://127.0.0.1:3000/ready
# {"status":"ready","db":"ok","redis":"ok"}
```

From your iPhone, open Safari and visit:

```
http://<mac-lan-ip>:3000/health
```

You should see the same JSON. If you don't:

- Allow Node through macOS Firewall (System Settings → Network → Firewall).
- Confirm the iPhone is on the same Wi-Fi (VPNs off).
- Try `ngrok http 3000` and swap the URL in Settings.

## Step 3 — Build and install on iPhone

```bash
# Terminal 3 (Metro)
cd mobile && npm start

# Xcode: Product → Run
```

Wait ~30-60 seconds for first build. App opens on phone.

First launch prompts:
- "Allow ParkWalk to use your location" → **Always Allow** (for
  background GPS during walks).
- "Allow ParkWalk to access motion and fitness" → Allow.

## Step 4 — Register an account

In the app: Onboarding → Create account.
- Username: any (e.g. `walktester`).
- Email: any real format (not verified in Phase 1).
- Password: 8+ chars.

Check the backend log — you should see a registration request.

## Step 5 — Seed entities near where you will walk

The seed script drops ~15 collectibles in a 200m radius around
`SEED_CENTER_LAT / SEED_CENTER_LNG` in `backend/.env`. Edit those to a park
or street near you, then re-run:

```bash
cd backend && npm run prisma:seed
```

## Step 6 — The actual walk

- Put on shoes.
- Leave the app in the foreground and start walking outside (GPS indoors
  is usually too noisy).
- Within ~15 seconds, the overlay should say **state: WALKING_VALID**.
- As you approach a seeded collectible, its marker should appear and you
  should be able to tap it.
- Tap → collect → success toast → `+N points`.

## Step 7 — Verify on the server

```bash
# From your Mac
psql 'postgresql://parkwalk:parkwalk_dev@localhost:5432/parkwalk' \
  -c "SELECT u.username, s.all_time_score, s.total_collections FROM users u JOIN user_stats s ON s.user_id = u.id;"
```

You should see your user with `all_time_score >= 10` and
`total_collections >= 1`.

```bash
# Check the collection row
psql 'postgresql://parkwalk:parkwalk_dev@localhost:5432/parkwalk' \
  -c "SELECT id, movement_validated, movement_state, points_earned, distance_from_entity_meters FROM user_collections ORDER BY collected_at DESC LIMIT 5;"
```

`movement_validated` must be `t` (true) and `movement_state` must be
`WALKING_VALID`.

## Step 8 — Adversarial tests (this is the proof of the USP)

### Stationary reject

- Sit still indoors with the app open for 30 seconds.
- Move next to a seeded collectible (walk to one first).
- Try to collect while still.
- Expected: `Cannot collect — Current movement state: STATIONARY…`
  Server never sees the request because the client blocks it.

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

## Step 9 — Record fixtures from a real walk

After a successful walk, pull the `movement_data` JSONB of a collection row
and save it as `backend/test/fixtures/real-walking-<date>.json`. Future
regressions can compare against real data, not synthetic.

## If something fails

- **Map loads but state stays UNKNOWN**: GPS has no samples. Walk outdoors
  with open sky. If still stuck, check that location permission is
  `Always` and motion is `Allowed`.
- **Collect button never enables**: you're outside the collection radius OR
  movement state is not `WALKING_VALID` (overlay shows which). Start
  walking again.
- **Collect returns 400 MOVEMENT_INVALID while walking**: compare the
  rejected summary with `walking.json` fixture. Most common causes: GPS
  accuracy too poor (urban canyon), or step count delta too low (holding
  phone very still). Log the summary; tune constants in
  `shared/src/constants.ts` if the real-world floor/ceiling differ from
  synthetic.
- **Collect returns 409 ALREADY_COLLECTED**: you already have that
  collectible. Walk to a different one.

## Move to Phase 2 when one of these becomes true

- You want a friend to test → enroll Apple Developer Program, TestFlight.
- You're tired of re-signing every 7 days → enroll Apple Developer Program.
- You want your Mac to sleep without killing the backend → Fly.io.
- You want realtime / social features → Socket.IO + web dashboard.
