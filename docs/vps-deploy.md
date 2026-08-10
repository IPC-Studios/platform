# Self-hosting the API on a VPS (Docker Compose)

The API is a Hono app (`services/api/src/index.ts`, `export default app`) with no
Cloudflare-specific bindings, so it runs unchanged on any host. This stack runs
it under Bun behind Caddy (auto-HTTPS), with an hourly cron ticker replacing the
Workers cron trigger. **Supabase stays external — nothing about the database
changes.** Cloudflare remains a working target; `wrangler` config is untouched.

## What's in the box

| File | Role |
|---|---|
| `services/api/src/server.ts` | Bun entrypoint — `Bun.serve` passing `process.env` as Hono's `env`. |
| `services/api/Dockerfile` | Bun image, build context = repo root (monorepo). |
| `docker-compose.yml` | `api` + `caddy` (TLS/proxy) + `cron` (hourly `/cron/reminders`). |
| `deploy/Caddyfile` | Reverse proxy for `$API_DOMAIN`, auto Let's Encrypt. |
| `deploy/.env.example` | All secrets/config the API reads. |

## One-time setup

1. **DNS**: point `api.yourstudio.in` (A/AAAA) at the VPS IP. Port 80 + 443 open.
2. **Install Docker** (Engine + Compose plugin).
3. **Clone + configure**:
   ```bash
   git clone https://github.com/IPC-Studios/platform.git && cd platform
   cp deploy/.env.example .env
   # edit .env — API_DOMAIN, SUPABASE_*, ALLOWED_ORIGINS, RAZORPAY_*, CRON_SECRET
   ```
   `ALLOWED_ORIGINS` must include the frontend origin, or the browser is CORS-blocked.
4. **Launch**:
   ```bash
   docker compose up -d --build
   ```
   Caddy fetches a cert on first boot. Verify:
   ```bash
   curl https://api.yourstudio.in/health   # {"ok":true,"service":"ipc-api",...}
   ```

## Point the frontend at it

Set `VITE_API_BASE_URL=https://api.yourstudio.in` (no trailing slash) and rebuild
the web app. The web app can stay on Cloudflare or move too — it's independent.

## Webhooks

Update the Razorpay (and Meta lead) webhook URLs to
`https://api.yourstudio.in/webhooks/...`. HMAC verification is runtime-agnostic;
`RAZORPAY_WEBHOOK_SECRET` must match the dashboard.

## Operating notes

- **Logs**: `docker compose logs -f api`
- **Update**: `git pull && docker compose up -d --build`
- **Cron**: the `cron` service POSTs `/cron/reminders` hourly with `x-cron-secret`.
  The job is idempotent + supports `?dry=1`. To run manually:
  ```bash
  curl -X POST https://api.yourstudio.in/cron/reminders -H "x-cron-secret: $CRON_SECRET"
  ```
- **Rate limiting**: the in-process sliding window now works as a real limiter
  (single long-lived process). If you scale to multiple API replicas, move it to
  a shared store (Redis) — see `docs/RUNBOOK.md`.
- **Scaling / HA**: this is a single-node setup. For multi-node, put the API
  behind a real load balancer and externalize rate-limit state.

## What you now own (vs Workers)

TLS renewal (Caddy handles it), process supervision (`restart: unless-stopped`),
OS patching, log/metric aggregation, firewall, backups, and DDoS posture — all
previously managed by Cloudflare.
