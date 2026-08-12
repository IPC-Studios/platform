# Self-hosting on a VPS (Docker Compose) — Postgres, no Supabase

The **backend** runs on your box: **self-hosted Postgres** + the Bun API + Caddy
(auto-HTTPS) + an hourly cron ticker. No Supabase. The **web frontend** deploys
separately to **Cloudflare Pages** (static SPA calling the VPS API). RLS is enforced
on plain Postgres exactly as before — the API connects as an unprivileged
`authenticator` role and `SET ROLE`s per request, binding `auth.uid()` from a JWT
claim, so every existing RLS policy / RPC / trigger works unchanged.

## What's in the box

| File | Role |
|---|---|
| `deploy/db/00_bootstrap.sql` | Recreates the Supabase surface on plain PG: `auth` schema + `auth.users`, `auth.uid()`, the role model, extensions, table grants. |
| `deploy/db/init.sh` | First-boot: runs the bootstrap, sets the authenticator password, applies migrations `0001..` in order. |
| `docker-compose.yml` | `db` (postgres:16) + `api` (Bun) + `caddy` (TLS/proxy) + `cron`. |
| `services/api/src/server.ts` | Bun entrypoint — `Bun.serve` passing `process.env` as Hono's `env`. |
| `deploy/Caddyfile` / `deploy/.env.example` | API reverse-proxy config / all secrets. |
| `.github/workflows/deploy.yml` | Push-to-main CD: `api` job (SSH → compose) + `web` job (build → Cloudflare Pages). |

## One-time setup

1. **DNS**: point `api.yourstudio.in` (A/AAAA) at the VPS IP. Ports 80 + 443 open.
   (The `app.` domain is managed by Cloudflare Pages.)
2. **Install Docker** (Engine + Compose plugin).
3. **Clone + configure**:
   ```bash
   git clone https://github.com/IPC-Studios/platform.git && cd platform
   cp deploy/.env.example .env
   # edit .env — API_DOMAIN, POSTGRES_PASSWORD, DB_AUTHENTICATOR_PASSWORD,
   #             JWT_SECRET, ALLOWED_ORIGINS, RAZORPAY_*, CRON_SECRET
   ```
   `ALLOWED_ORIGINS` must include the Cloudflare Pages origin or the browser is CORS-blocked.
4. **Launch** (db initialises + migrates on first boot):
   ```bash
   docker compose up -d --build
   ```
   Verify:
   ```bash
   curl https://api.yourstudio.in/health          # {"ok":true,"service":"ipc-api",...}
   API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs   # end-to-end auth + RLS
   ```
   `rls-live.mjs` registers two throwaway studios and proves one cannot read the
   other's data — the real cross-tenant RLS gate.

## First platform admin (no UI, by design)

```bash
docker compose exec db psql -U postgres -d ipc \
  -c "insert into platform_admins (user_id) select id from auth.users where email = 'you@studio.in';"
```

## The frontend (Cloudflare Pages)

The web SPA is a static build hosted on Cloudflare Pages, calling the VPS API.
Build-time it needs `VITE_API_BASE_URL=https://api.yourstudio.in`. SPA history
routing is handled by `apps/web/public/_redirects` (`/* /index.html 200`). Auth is
a bearer token in `localStorage`; no Supabase client in the browser. Point the
Pages custom domain (`app.yourstudio.in`) via Cloudflare, and add that origin to
the API's `ALLOWED_ORIGINS`.

## Continuous deploy (GitHub Actions)

`deploy.yml` ships every push to `main` in two independent jobs:
- **`api`** — SSHes into the VPS, `git reset --hard origin/main`, then
  `docker compose up -d --build --wait` (blocks on the db + api healthchecks, so a
  broken build fails the run).
- **`web`** — builds the SPA with `VITE_API_BASE_URL` and `wrangler pages deploy`.

Arm it once (repo **variable** `DEPLOY_ENABLED=true`) with these **secrets**:
- Backend: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PATH` (+ `VPS_PORT` if not 22).
- Frontend: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `API_BASE_URL`.

The VPS repo needs a **deploy key** (private repo) and a `.env`. Migrations run only
on the db's first boot, so ordinary deploys just rebuild the API.

## Webhooks

Update Razorpay (and Meta lead) webhook URLs to `https://api.yourstudio.in/webhooks/...`.
HMAC verification is runtime-agnostic; `RAZORPAY_WEBHOOK_SECRET` must match.

## Operating notes

- **Logs**: `docker compose logs -f api` / `... db`
- **Backups**: `docker compose exec db pg_dump -U postgres ipc > backup.sql`
- **Migrations**: `init.sh` runs them on the db's FIRST boot only (empty volume).
  To apply new migrations to a live DB, `psql` them in manually or run them via a
  one-off, then restart the API. (A dedicated migrate step can be added later.)
- **Cron**: the `cron` service POSTs `/cron/reminders` hourly with `x-cron-secret`
  (idempotent, supports `?dry=1`).
- **Auth**: HS256 JWT, 7-day token, no refresh yet. Rotating `JWT_SECRET` logs
  everyone out. Password reset / email confirmation are not implemented.
- **Rate limiting**: the in-process sliding window is a real limiter now (single
  long-lived process); multi-replica needs a shared store (Redis).

## What you now own (vs Supabase + Cloudflare)

The database itself (backups, upgrades, tuning), TLS renewal (Caddy), process
supervision, OS patching, monitoring, firewall, and DDoS posture.
