# Deploy backend to Railway — step-by-step runbook

This guide is written for **ParkWalk’s monorepo** (backend + `shared` workspace). Follow the steps in order. Approximate time: **30–45 minutes** the first time.

---

## What you need from yourself (gather first)

| Item | Why |
|------|-----|
| **GitHub account** + **ParkWalk repo** pushed (e.g. `main` branch) | Railway deploys from Git. |
| **Railway account** ([railway.app](https://railway.app)) — sign up with GitHub | Single sign-on is easiest. |
| A **long random `JWT_SECRET`** (at least **32 characters**) | Generate in Terminal: `openssl rand -base64 48` — paste the output once into Railway (treat it like a password; don’t commit it). |
| **Rough map coordinates** where you want test markers (optional for first deploy) | For seeding later: latitude/longitude of your campus or park. |
| **Credit card** on Railway (if their free trial requires it) | Check current Railway pricing; small projects are usually cheap. |

**What you might paste to a teammate / assistant later (no secrets in chat):**

- Your **public Railway service URL** (HTTPS), after deploy.
- Whether `/health` and `/ready` return OK.
- **Not** your raw `JWT_SECRET` or database password.

---

## How this fits your workflow

- **Backend** runs on Railway (internet URL).
- **iPhone app** uses that URL as `API_BASE_URL` — works on **cellular** or any Wi‑Fi.
- You still develop **locally** on your Mac; when you **merge to `main`**, Railway can **auto-redeploy** (if you turn that on).

---

## Technical notes (why this repo is special)

| Topic | Detail |
|-------|--------|
| **Monorepo** | Install and build from the **repo root**, not only `backend/`, so `@parkwalk/shared` links. |
| **PostGIS** | First migration already runs `CREATE EXTENSION postgis`. **`prisma migrate deploy`** on start applies it — no manual SQL unless something fails. |
| **Health URLs** | `GET /health` (liveness) and `GET /ready` (DB + Redis) are at the **root**, not under `/api/v1`. |

---

## Step 1 — Push latest code to GitHub

On your Mac, from the repo root:

```bash
git status
git push origin main
```

(Use your real default branch name if it isn’t `main`.)

**You need:** a clean push so Railway builds what you expect.

---

## Step 2 — Create a Railway project

1. Log in at [railway.app](https://railway.app).
2. **New Project** → **Deploy from GitHub repo**.
3. Authorize Railway to read your GitHub account if asked.
4. Select the **ParkWalk** repository.

**Don’t** finish deploying a “default” Node app yet — add databases first (next steps), then configure the service.

---

## Step 3 — Add PostgreSQL

1. In the project, **+ New** → **Database** → **PostgreSQL**.
2. Wait until it provisions.
3. Open the Postgres service → **Variables** (or **Connect**). Note that Railway creates something like **`DATABASE_URL`**.

You will **reference** this URL from your **API service** in Step 6.

---

## Step 4 — Add Redis

1. **+ New** → **Database** → **Redis**.
2. Railway creates **`REDIS_URL`** (or similar).

Again, you’ll reference this from the API service.

---

## Step 5 — Create the API service (same repo)

1. **+ New** → **GitHub Repo** → choose **ParkWalk** again **or** “Empty service” then connect repo — whichever matches the current Railway UI.
2. Name it e.g. **`api`** or **`parkwalk-backend`**.

**Critical settings:**

| Setting | Value |
|---------|--------|
| **Root directory** | Leave **empty** (use **whole repository**). **Do not** set to `backend` only. |
| **Branch** | `main` (or your deploy branch). |

---

## Step 6 — Build and start commands

Open your **API service** → **Settings** → **Build** / **Deploy** (wording varies).

**Build command:**

```bash
npm ci && npm run build -w @parkwalk/shared && npm run prisma:generate -w backend && npm run build -w backend
```

**Start command:**

```bash
npm run prisma:migrate:deploy -w backend && npm run start -w backend
```

- First deploy runs **migrations** (creates tables + PostGIS extension).
- **Do not** add `prisma:seed` to the start command — seeding **wipes** dev data; run it manually when you want (see Step 9).

---

## Step 7 — Environment variables

On the **API service**, open **Variables**.

### 7a — Link database and Redis

Use Railway’s **variable references** (recommended) so URLs stay in sync:

- Add **`DATABASE_URL`** → reference the **Postgres** service’s `DATABASE_URL`.
- Add **`REDIS_URL`** → reference the **Redis** service’s `REDIS_URL`.

(If the UI shows “Add Reference”, use that. Otherwise copy the values once from each database service — references are better long-term.)

### 7b — Required app variables

| Name | Example / rule |
|------|----------------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Output of `openssl rand -base64 48` (≥ 32 chars) |
| `ALLOWED_ORIGINS` | For alpha, `*` is simplest if you accept open CORS for your API; or `https://your-app.railway.app` if you add a web client later. Mobile often sends no `Origin` — your server already allows that. |

Optional (defaults exist in code — see [`backend/src/env.ts`](../backend/src/env.ts)):

- `API_VERSION` — default `v1`
- `LOG_LEVEL` — e.g. `info`

**Railway** usually sets **`PORT`** automatically — the app already listens on `env.PORT`.

---

## Step 8 — Generate a public URL

1. Open the **API service** → **Settings** → **Networking** (or **Public**).
2. **Generate domain** / enable **public HTTP** so you get `https://something.up.railway.app`.

Save this URL — you’ll use it in the mobile app.

---

## Step 9 — Deploy and watch logs

1. Trigger a deploy (**Deploy** / push a commit if auto-deploy is on).
2. Open **Deployments** → **View logs**.

**Success signs:**

- Build finishes without `npm ci` / `tsc` errors.
- Runtime log shows something like “ParkWalk backend ready” and **port** matches Railway’s `PORT`.
- No crash right after `prisma migrate deploy`.

**Quick checks in a browser:**

- `https://YOUR-URL/health` → JSON with `"status":"ok"`.
- `https://YOUR-URL/ready` → JSON with `"status":"ready"`, `"db":"ok"`, Redis ok.

If `/ready` is **503**, read the JSON error — usually wrong `DATABASE_URL` / `REDIS_URL` or DB not ready yet (wait 1 minute, redeploy).

---

## Step 10 — Seed game markers (manual, when you want)

[`backend/prisma/seed.ts`](../backend/prisma/seed.ts) **deletes** existing `game_entities` and `user_collections` — use when you want a **fresh** world.

**Before seeding**, set in Railway **Variables** (optional but recommended):

- `SEED_CENTER_LAT`, `SEED_CENTER_LNG` — where you walk.
- `SEED_SCATTER_METERS` — e.g. `80`–`120` for a tight campus test.
- `SEED_ENTITY_COUNT`, `SEED_MIN_SPACING_METERS` — optional.

Run **once** via Railway **one-off command** or [Railway CLI](https://docs.railway.app/develop/cli):

```bash
railway run npm run prisma:seed -w backend
```

(From repo root, linked to the right project/service.)

---

## Step 11 — Point the iPhone app at Railway

1. On the phone (or in `mobile/.env` for the next Xcode build), set:

   `API_BASE_URL=https://YOUR-RAILWAY-URL`

   **No trailing slash.**

2. In the app: **Settings** → **Use LAN** / edit field — paste the **HTTPS** Railway URL, or rebuild with updated `.env`.
3. Build/run from **Xcode**. Test **Register** and **Map** on **cellular** if you can.

---

## Step 12 — GitHub auto-deploy (optional)

In Railway: connect **deploy triggers** to **`main`** (or your branch) so every merge redeploys the API.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Build fails: cannot find `@parkwalk/shared` | Root directory set to `backend` only — use **repo root**. |
| Build fails: `prisma generate` | Ensure **backend** workspace is named `@parkwalk/backend` in `package.json` and build runs `-w backend`. |
| `/ready` 503 | Wrong or missing `DATABASE_URL` / `REDIS_URL`; Postgres/Redis not up. |
| `migrate deploy` fails on `postgis` | Rare — Railway Postgres should allow extensions; check Railway docs or support. |
| App: network error | Typo in `API_BASE_URL`; must be **https**; no trailing slash issues; service not public. |

---

## What to send back if you’re stuck

Paste (redact secrets):

1. **Last 30 lines** of Railway **build** log (if build failed).
2. **Last 30 lines** of Railway **deploy** log (if crash).
3. Output of `https://YOUR-URL/health` and `https://YOUR-URL/ready` (status code + JSON body).

---

## Cost and fallback

- Confirm current pricing on [railway.app](https://railway.app).
- **Render** + same build/start commands from repo root is a reasonable backup — see [`docs/11-DEPLOYMENT.md`](11-DEPLOYMENT.md) when it exists, or mirror this doc’s commands.
