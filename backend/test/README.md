# backend/test

## Unit tests

Run:

```bash
cd backend && npm test
```

The movement validation tests use committed fixtures:

- `fixtures/walking.json` — synthetic 10-second walk (~1.2 m/s). Must PASS validation.
- `fixtures/driving.json` — synthetic 10-second drive (~15 m/s, AUTOMOTIVE activity). Must FAIL.
- `fixtures/teleport-spoof.json` — two geofenced clusters 500m apart with 10s delta and near-flat accelerometer. Must FAIL despite a client summary that claims WALKING_VALID.

Replace the synthetic fixtures with fixtures you record yourself once you do
your first walk with the app; see `scripts/record-fixture.ts` (not yet
implemented) or simply copy the `movement_data` JSONB from any
`user_collections` row written during a real walk.

## Integration tests

Requires Docker services to be up and Prisma migrations applied:

```bash
npm run infra:up
cd backend
npx prisma migrate deploy
npm run test:integration
```

The Jest integration config supplies local defaults that match
`backend/.env.test.example`, so you do not need to export env vars for the
standard Docker setup. Integration tests enable nearby auto-seeding with a
small target count so `/entities/nearby` placement behavior is covered.
Override `DATABASE_URL`, `REDIS_URL`, or `JWT_SECRET` only when pointing the
suite at a different test database.

The integration suite boots the full Express app via `buildApp()` and hits
it with `supertest`. It covers:

- register + login happy path
- collect accepts walking with a valid Idempotency-Key
- collect rejects driving with `MOVEMENT_INVALID`
- collect rejects out-of-range with `OUT_OF_RANGE`
- collect with the same Idempotency-Key replays the stored result
- collecting the same entity twice with a new key returns `ALREADY_COLLECTED`
- nearby auto-seeding tops up a small shared cluster around the requested
  location and does not keep inserting once the target count is visible
