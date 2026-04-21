# CI workflows

## ci.yml (Phase 1)

Runs on every PR and push to main. Keeps feedback fast for the solo dev:

1. **shared** — typecheck + build `@parkwalk/shared`. Gating dependency for
   everything else.
2. **backend** — typecheck + unit tests for `@parkwalk/backend`
   (MovementValidationService against the committed fixtures). Does NOT run
   integration tests in Phase 1 (they need Postgres+PostGIS+Redis via
   Testcontainers — Phase 2).
3. **mobile-typecheck** — soft typecheck. Native iOS builds stay local in
   Phase 1 (macOS runner cost + signing). Phase 2 adds Fastlane.

Nothing is deployed automatically. Phase 2 adds:
- Testcontainers-backed integration tests.
- Contract tests generated from shared Zod schemas.
- k6 WebSocket load test.
- Coverage upload with gates.
- Optional Fastlane-based iOS build on macOS runner.
- OIDC-based deploy role for Fly.io.
