# DigitalOcean App Platform Deployment Plan

Lift-and-shift the existing FastAPI + React monolith from Cloud Run onto **DigitalOcean App Platform**, keeping the codebase intact. No Appwrite. Frontend stays bundled with the backend in the existing single-service Docker image.

## Decisions (Locked In)

- **Hosting:** DigitalOcean App Platform (managed PaaS), reusing the existing `Dockerfile` and `.do/app.yaml` scaffold.
- **Service shape:** Single Web Service — backend serves the built frontend from `/app/frontend_dist` (already wired in `main.py`).
- **Database:** DO Managed **MySQL** (development tier). Existing models use MySQL-specific `LONGBLOB` types, so Postgres would require a non-trivial schema rewrite that's out of scope here.
- **Auto-deploy:** App Platform watches `main` on the GitHub repo and rebuilds on push (already configured in `.do/app.yaml`).
- **Reverted:** The earlier Appwrite work on `frontend/cleanLogic/src/services/appwrite.js` and `api.js` has been rolled back to its pre-migration state. `.env.example` from that effort was not committed.
- **Execution cadence:** One task at a time. The `⏸ STOPPED HERE` pointer below moves to the just-finished task. I wait for `continue` before starting the next.

## Status Legend

| Marker | Meaning |
|--------|---------|
| `⬜` | Pending — not started |
| `🟡` | In progress |
| `✅` | Done — ready for review |

## Proposed Changes

### Phase 1: Strip Cloud Run-Specific Code
Cloud Run cruft inflates the codebase and confuses future maintainers. Cleanup before deploy.

#### ✅ Task 1 — [MODIFY] Strip Cloud Run hostnames + Cloud SQL code path
Remove the hardcoded Cloud Run URLs from the CORS allow-list in `backend/main.py` and delete the `CLOUD_SQL_CONNECTION_NAME` branch in `backend/app/db/connection.py`. Delete `.gcloudignore`. Replaces them with `DATABASE_URL`-only resolution.

#### ✅ Task 2 — [MODIFY] Drop the 30 MiB chunked upload workaround
The chunked upload path in `backend/app/routes/upload.py` exists solely to dodge Cloud Run's 32 MiB ingress cap. App Platform allows up to 100 MiB request bodies by default, so we keep the chunk endpoints (frontend still calls them for very large files) but raise the threshold and remove the Cloud Run-specific commentary. Frontend `services/api.js` threshold is bumped to match.

⏸ **STOPPED HERE — Task 2 complete**

### Phase 2: App Platform Configuration

#### ✅ Task 3 — [MODIFY] `.do/app.yaml` — production-ready service spec
Add: required env vars (`DATABASE_URL` from DB component, `GEMINI_API_KEY` as a secret, `CORS_ORIGINS`, `VITE_GOOGLE_CLIENT_ID` as a build arg), proper instance size (`apps-s-1vcpu-2gb` minimum — current `1gb` is too small for `catboost`+`pandas`), HTTP health check on `/health`, and a managed-DB component pointing to MySQL.

⏸ **STOPPED HERE — Task 3 complete**

#### ✅ Task 4 — [NEW] `backend/.env.example` + `frontend/cleanLogic/.env.example`
Document every env var consumed by the app, with comments on whether each is required, build-time vs runtime, and where to set it on App Platform (Console vs `app.yaml`).

⏸ **STOPPED HERE — Task 4 complete**

### Phase 3: Verification + Docs

#### ✅ Task 5 — [MODIFY] Verify `/health` endpoint suits App Platform's HTTP health check
Confirm `@app.get("/health")` returns 200 quickly (no DB hit). Add a `/ready` endpoint if a deeper readiness probe is wanted, then wire it in `app.yaml`.

#### ✅ Task 6 — [NEW] `docs/deploy-to-do-app-platform.md`
Step-by-step runbook: create the App in DO Console (or via `doctl apps create --spec .do/app.yaml`), attach the managed MySQL database, set secrets, trigger first deploy, configure custom domain.

⏸ **STOPPED HERE — Tasks 5 & 6 complete**

## Verification Plan

### Automated
- `npm run build` inside `frontend/cleanLogic/` to confirm the bundle still builds.
- `docker build -t capsss-app -f Dockerfile .` to confirm the production image still builds (frontend + backend layers).
- (Optional) `doctl apps spec validate .do/app.yaml` if `doctl` is installed locally.

### Manual
- Push a commit to `main`; confirm App Platform auto-deploy succeeds.
- Hit `/health` — expect 200 OK.
- Hit `/api` — expect the JSON banner response.
- Run an end-to-end smoke test: register → upload `wine.xlsx` → profile → apply a cleaning step → train a Linear Regression → export.

## Rollback Strategy

Each task is a small, self-contained edit. Reverting a single commit on `main` rolls back that task. App Platform also keeps the previous deployment alive until the new one passes its health check, so a failed deploy never takes down the live site.
