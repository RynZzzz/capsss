# Deploy CleanLogic to DigitalOcean App Platform

Step-by-step runbook for deploying the CleanLogic monolith (FastAPI + React) on DigitalOcean App Platform using the existing Dockerfile.

---

## Prerequisites

- A DigitalOcean account with billing enabled.
- The GitHub repo (`RynZzzz/capsss`) connected to your DO account (Settings → Integrations → GitHub).
- (Optional) `doctl` CLI installed and authenticated — `doctl auth init`.

---

## Option A: Deploy via DO Console (UI)

### 1. Create the App

1. Go to **Apps → Create App**.
2. Source: **GitHub** → select `RynZzzz/capsss`, branch `main`.
3. DO will auto-detect the Dockerfile. Confirm the detected settings:
   - Dockerfile path: `Dockerfile`
   - HTTP port: `8080`
4. Click **Next**.

### 2. Attach a Managed MySQL Database

1. On the **Resources** step, click **Add Resource → Database**.
2. Choose **MySQL 8**, plan **Development**.
3. Name it `db` (must match the `${db.DATABASE_URL}` reference in `app.yaml`).
4. Click **Attach**.

### 3. Set Environment Variables

In the service's **Environment Variables** section, add:

| Key | Value | Type |
|-----|-------|------|
| `DATABASE_URL` | `${db.DATABASE_URL}` | General |
| `CORS_ORIGINS` | `${APP_URL}` | General |
| `VITE_GOOGLE_CLIENT_ID` | `191625527569-...` | General |
| `GOOGLE_CLIENT_ID` | `191625527569-...` | General |
| `GEMINI_API_KEY` | *(your key)* | **Secret** |
| `GROQ_API_KEY` | *(your key)* | **Secret** |

> `VITE_GOOGLE_CLIENT_ID` must be set as a **build-time** variable (toggle "Available during build" in the Console) so it gets baked into the frontend bundle.

### 4. Configure Instance Size

- Set to **Basic → 1 vCPU / 2 GB RAM** (`apps-s-1vcpu-2gb`) minimum.
- CatBoost + Pandas model training needs more than 1 GB.

### 5. Health Check

Confirm the health check is set to:
- Path: `/health`
- Port: `8080`
- Initial delay: 10s

### 6. Deploy

Click **Create Resources**. App Platform will:
1. Clone the repo.
2. Build the Docker image (frontend + backend).
3. Start the container.
4. Run health checks — once `/health` returns 200, traffic is routed.

---

## Option B: Deploy via `doctl` CLI

```bash
# Validate the spec first
doctl apps spec validate .do/app.yaml

# Create the app. The spec provisions a dev MySQL database named `db`
# with database/user names set to `cleanlogic`.
doctl apps create --spec .do/app.yaml

# The command returns an app ID. Save it:
export APP_ID=<returned-app-id>

# Check deployment status
doctl apps get $APP_ID --format Status

# View logs
doctl apps logs $APP_ID --type run
```

Before the first production deploy, set real **secret** env var values via the Console or an update spec. Keep plaintext secrets out of the checked-in `.do/app.yaml`.

```bash
doctl apps update $APP_ID --spec .do/app.yaml
```

---

## Post-Deploy Verification

### Automated checks

```bash
# Health probe (should return {"status": "healthy"})
curl https://<your-app-url>/health

# Readiness probe — confirms DB connectivity (should return {"status": "ready"})
curl https://<your-app-url>/ready

# API banner
curl https://<your-app-url>/api
```

### Manual smoke test

1. Open `https://<your-app-url>` — the React frontend should load.
2. Register a new account (or sign in with Google).
3. Upload `wine.xlsx` (or any test file).
4. Wait for profiling to complete.
5. Apply a cleaning step (e.g., impute missing values).
6. Train a Linear Regression model.
7. Export the cleaned dataset.

---

## Custom Domain

1. Go to **Apps → your app → Settings → Domains**.
2. Click **Add Domain** → enter your domain (e.g., `app.cleanlogic.io`).
3. Add the CNAME record shown by DO to your DNS provider.
4. DO provisions a free Let's Encrypt TLS certificate automatically.
5. Update `CORS_ORIGINS` to include the custom domain if it differs from `${APP_URL}`.

---

## Scaling

- **Vertical:** Bump `instance_size_slug` in `app.yaml` (e.g., `apps-s-2vcpu-4gb` for heavier ML workloads).
- **Horizontal:** Increase `instance_count` — works because the app is stateless (all state lives in MySQL). Note: in-memory profiler caches won't be shared across instances, but the DB fallback handles this gracefully.

---

## Rollback

App Platform keeps the previous deployment alive until the new one passes health checks. If a deploy fails:

- The live site stays on the last healthy version automatically.
- To manually roll back: **Apps → Deployments → select a previous deployment → Rollback**.
- Or revert the commit on `main` — auto-deploy will rebuild from the reverted state.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Deploy fails at build | Missing build arg | Ensure `VITE_GOOGLE_CLIENT_ID` is set with "Available during build" toggled on |
| Container starts then crashes | `DATABASE_URL` not set | Confirm the DB component is named `db` and the env var uses `${db.DATABASE_URL}` |
| `/ready` returns 503 | DB not reachable | Check the managed DB is in "online" state; verify SSL mode in connection string |
| CORS errors in browser | `CORS_ORIGINS` mismatch | Set to your actual domain (include `https://`). Multiple origins: comma-separated |
| Upload fails for large files | Body too large | App Platform allows 100 MiB by default; check file isn't over `MAX_FILE_SIZE` (200 MiB) |
| Google sign-in fails | Client ID mismatch | Ensure `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend) match, and the authorized origin in Google Console includes your app URL |
