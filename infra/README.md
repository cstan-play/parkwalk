# infra/

Local development services for ParkWalk.

## Usage

From the repo root:

```bash
npm run infra:up       # start Postgres+PostGIS + Redis in the background
npm run infra:logs     # follow logs
npm run infra:down     # stop services (keeps volumes)
npm run infra:reset    # nuke volumes + recreate (destroys all dev data)
```

## Services

| Service  | Host port | Connection string                                         |
| -------- | --------- | --------------------------------------------------------- |
| Postgres | 5432      | `postgresql://parkwalk:parkwalk_dev@localhost:5432/parkwalk` |
| Redis    | 6379      | `redis://localhost:6379`                                  |

`init-postgis.sql` runs on first DB creation and enables the `postgis` and
`uuid-ossp` extensions. Prisma migrations then add the spatial columns and
GIST index.

## Dockerfile.backend

Multi-stage build used by `npm run build:docker` (smoke) and later by Fly.io
deploy. Fixes the Phase 2 gap documented in `docs/11-DEPLOYMENT.md` where the
original Dockerfile ran `npm ci --only=production` before the TypeScript
build step — that would strip out `typescript`, `prisma`, and `ts-node-dev`
before `tsc` could run.
