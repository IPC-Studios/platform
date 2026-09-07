# IPC Studios — Operations Runbook

## Environments & secrets

Backend secrets live in the repo-root `.env` on the VPS (consumed by Docker
Compose); the web app's build-time vars live in Cloudflare Workers Builds. Never commit
them. `deploy/.env.example` lists every variable.

| Variable | Where | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` (db superuser) | Change in Postgres, then `.env`, then `up -d` |
| `DB_AUTHENTICATOR_PASSWORD` | `.env` (role the API logs in as) | The `migrate` service re-applies it on every deploy |
| `RESEND_API_KEY` | `.env` | Rotate in Resend → `up -d api` |
| `BACKUP_S3_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` | `.env` | Scoped to the backup bucket; rotate in the storage provider |
| `JWT_SECRET` | API | HS256 signing key. Rotating it signs everyone out. |
| `CRON_SECRET` | API + scheduler | Compared in constant time. Rotate both sides together. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | API | With the key pair set, `/subscription/order` creates a Razorpay order and `/subscription/activate` **requires** the Checkout signature. Without it, activation is only allowed when `ENVIRONMENT` is `development`, `test`, `ci` or `local`. |
| `META_VERIFY_TOKEN` / `META_APP_SECRET` / `META_PAGE_ACCESS_TOKEN` | API | Handshake token, post signature secret, Graph API page token (see "Meta lead ads and WhatsApp"). |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | API | Optional. Templates are delivered by the WhatsApp Cloud API when both are set. |
| `AUTH_COOKIE` / `AUTH_COOKIE_SAMESITE` / `AUTH_COOKIE_DOMAIN` | API | Optional. `AUTH_COOKIE=1` keeps the refresh token in an HttpOnly cookie (see "Refresh-token cookie mode"). |
| `ALLOWED_ORIGINS` | API | Comma-separated prod origins. Empty in production = deny all. |
| `CLIENT_IP_HEADER` | API | Which header carries the real client address. `X-Forwarded-For` (default, last hop; Caddy/nginx) or `CF-Connecting-IP` (behind Cloudflare). Trusting the wrong one lets callers pick their own rate-limit bucket. |
| `SENTRY_DSN` | API | Optional. Unexpected failures are posted as Sentry events. Unset = logs only. |
| `LOG_LEVEL` | API | `debug` / `info` / `warn` / `error`. |
| `APP_VERSION` | API | Release id shown by `/health` and stamped on error reports. |
| `ENVIRONMENT` | API | `production` fails closed everywhere (token echo, demo activation, CORS). |

## Logging, request ids, error tracking

- Every request gets an `X-Request-Id` (an inbound one from a trusted proxy is
  kept). It is echoed on the response, stamped on every log line the request
  produces, and written into `audit_logs.correlation_id`.
- Logs are JSON lines on stdout (pino-shaped: `level`, `time`, `msg`, fields).
  `docker compose logs api | grep <request-id>` finds everything about one call.
- Any failing operation goes through `attempt()` (`services/api/src/lib/attempt.ts`):
  it logs the Postgres code and message, sets `X-Correlation-Id`, reports to
  Sentry when configured, and maps `42501`→403, `23505`/`23503`→409,
  `22023`/`P0001`→422, connection loss→503 instead of a blanket 400. There are no
  swallowed `.catch(() => null)` calls left in the API.
- The web client shows the id under any failed panel as "Reference: …" — ask
  the user for it.

## Audit trail

`audit_logs` records who did what to which row (`action`, `entity_type`,
`entity_id`, `before`, `after`, `ip`, `correlation_id`). Writes go through
`audit_log_write()` (SECURITY DEFINER, stamps the caller's own studio). The
owner reads it at **Settings → System**, or via `GET /settings/audit`.
Domain-specific trails remain: `access_audit_logs`, `billing_events`,
`crm_lead_events`, `razorpay_webhook_events`.

## Cron

The `cron` service (or any scheduler) calls `POST /cron/reminders` hourly with
`x-cron-secret: $CRON_SECRET`. One tick runs `run_reminder_cron()`,
`run_crm_followup_cron()` (overdue follow-ups → notifications + automation
rules) and sweeps expired refresh tokens. `?dry=1` is a no-op run. Every run
lands in `cron_runs`; read it at **Settings → System** or `GET /cron/runs`
(owner or platform admin). A row with no `finished_at` did not complete.

## Rate limiting

`services/api/src/middleware/security.ts`. Sign-in surfaces (`/auth/login`,
register, verify, reset, invite) share one bucket of 10/min per address;
session upkeep (`/auth/session`, `/auth/refresh`, sign-out) has its own
120/min bucket so an office NAT is never locked out of the app. The store is
in-process and bounded (stale keys swept, LRU-evicted past 10k keys). It is
per process: before running more than one API replica, move the store behind
something shared (Postgres unlogged table or Redis) — the `HitStore` interface
is the seam.

## Health

`GET /health` → `{ ok, service, version, uptime_s, db, db_latency_ms }`. `db` is
`ok`, `unreachable` (503) or `not_configured`. It names no environment and
repeats no driver error text. Point uptime monitors at it.

## RLS is the primary enforcement

Every tenant table has `company_id` and an RLS policy scoped to
`get_current_company_id()`. Since 0034 that oracle resolves for any live
member **regardless of plan**; the plan gate lives in `is_current_user_active()`,
which feature tables use. That is what keeps the subscription page reachable
when the plan has lapsed — the recovery path must not sit behind the thing it
recovers from. The API connects as the unprivileged `authenticator` role and
`SET ROLE`s to `authenticated` per request with the caller's id in a GUC, so the
database — not application code — is what keeps studios apart.

## DB verification

Migrations are logic-tested against pglite in `supabase/tests/tenancy.test.ts`
(0001–0039 applied in order). pglite runs as superuser, so RLS *enforcement* is
proven on real Postgres by `supabase/tests/rls-live.mjs` and by the CI `e2e`
job, which registers two throwaway studios over HTTP and asserts studio A
cannot read studio B's company, clients or users.

Run it against any environment:

```bash
API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs
```

## Payments

Checkout: `POST /subscription/order` prices the plan in SQL (+18% GST) and,
with Razorpay configured, registers the order with Razorpay and returns
`razorpay_order_id` + `key_id`. The browser opens Razorpay Checkout; on success
it posts `{order_id, payment_id, signature}` to `/subscription/activate`, which
verifies the HMAC before touching the plan. The webhook (`/webhooks/razorpay`)
is the belt-and-braces path: signature-checked, replay-proof
(`razorpay_webhook_events`), and activates by the provider order id.

## Web app (Cloudflare Workers static assets)

`apps/web/public/_redirects` rewrites every path to `index.html` (deep links
survive a refresh). `apps/web/public/_headers` sets HSTS, frame denial and a
CSP that permits only the app's own scripts plus Razorpay Checkout. Its
`connect-src` is `https:` because the build cannot template the API origin —
tighten it to `'self' https://api.<your-domain>` once known.

## Backups & restore

The `backup` service (`deploy/backup/`) runs `pg_dump -Fc` once at container
start and then daily at `BACKUP_AT_UTC` (default 02:30 UTC). Each dump is
verified with `pg_restore --list` before it counts as a success; local copies are
pruned after `BACKUP_KEEP_DAYS` (7).

**Off-box copies are opt-in and you want them on.** Set `BACKUP_S3_BUCKET` and
the rest of the `BACKUP_S3_*` block in `.env` (any S3-compatible bucket — R2, B2,
S3, MinIO) and each dump is uploaded with rclone and pruned after
`BACKUP_OFFSITE_KEEP_DAYS` (30). Without it every backup sits on the same disk as
the database it is protecting.

The container goes **unhealthy** if there has been no successful local backup in
26h (or no off-box copy in 72h, when configured), so a backup path that quietly
breaks shows up in `docker compose ps` and fails the next deploy's `--wait`.

```bash
docker compose logs backup                       # what it has been doing
docker compose run --rm backup once              # take one right now
docker compose run --rm backup restore list      # what exists, here + off-box
```

### Restore

Destructive — it drops and recreates the database, so stop the API first.

```bash
docker compose stop api cron
docker compose run --rm -e RESTORE_CONFIRM=yes backup restore latest
docker compose up -d migrate api cron
```

Without `RESTORE_CONFIRM=yes` it prints what it would do and stops. Pass a dump
filename instead of `latest` to pick one; a name that isn't on this box is pulled
from off-box storage automatically.

**Do a restore drill on a scratch VPS before you need one.** An untested backup
is a hope. What to check afterwards: `/health` is green, a studio owner can log
in, and a project's invoices and payments still add up.

## Incident response

- Start from the reference id the user quotes. It is the request id: grep the
  API logs for it, then `select * from audit_logs where correlation_id = '…'`.
- Payment disputes: `payment_orders`, `payment_transactions`,
  `razorpay_webhook_events`, `billing_events`, plus `audit_logs` rows with
  `entity_type = 'payment_order'`.
- Access disputes: `access_audit_logs` (profile/override changes) and
  `audit_logs` (`member.*`, `role.*`, `access.set`).
- A member removed from a studio loses their session at the next refresh
  (0034 `rotate_refresh_token`), and `revoke_all_sessions` is called on removal.

## Security posture notes

- No plaintext credentials are stored. Passwords are argon2id (Bun.password).
- Tokens: 30-minute access JWT + 30-day rotating refresh family; a reused
  refresh token revokes its family. Change-password and sign-out-everywhere
  bump `password_version`, stranding every earlier access token.
- Client links (`work_delivery`, `terms_ack`, invitations, resets) store only a
  sha256 hash of the token.
- Meta lead ads: signature-verified posts, lead fields fetched by `leadgen_id`
  (see below). Any plain JSON form can still post to the same source URL.

## Refresh-token cookie mode

`AUTH_COOKIE=1` moves the 30-day refresh token into an `HttpOnly; Secure`
cookie named `ipc_refresh`, scoped to `/auth` on the API origin. The response
body then carries `refresh_token: ""`; the SPA keeps only the 30-minute access
token (in memory, mirrored to sessionStorage per tab) and sends the cookie on
`/auth/*` calls. Turn it on when the app and the API share a registrable domain
(`app.studio.in` + `api.studio.in`, with `AUTH_COOKIE_SAMESITE=lax` and
optionally `AUTH_COOKIE_DOMAIN=.studio.in`). On split sites use
`AUTH_COOKIE_SAMESITE=none` (HTTPS only); Safari may still refuse the cookie
as third-party, so prefer a shared domain. Off (default), the body token is used
as before; the client handles both.

## Meta lead ads and WhatsApp

- `META_VERIFY_TOKEN` completes the subscription handshake; `META_APP_SECRET`
  verifies `X-Hub-Signature-256` on every post (a Meta-shaped post without one
  is refused once the secret is set); `META_PAGE_ACCESS_TOKEN` fetches the
  lead's fields by `leadgen_id` from the Graph API (v21.0). With the page token
  unset, Meta notifications are acknowledged and logged but not imported.
- `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` make "send template"
  deliver through the WhatsApp Cloud API (text messages). Unset, the API hands
  back a `wa.me` link and the person's own WhatsApp opens with the text.

## CRM cadences and the hourly sweep

A cadence is a sequence of follow-up steps (day offsets, optional template,
note). `start_lead_cadence()` puts a lead on one (also via the automation
action `start_cadence`); the hourly `/cron/reminders` tick calls
`run_crm_followup_cron()`, which advances due steps (next follow-up on the
lead, notification to its owner, history event), then handles overdue
follow-ups and their rules. Winning or losing a lead stops its cadence. There
is no `pg_cron`; the `cron` compose container is the scheduler.

Saved CRM views live in `crm_saved_views` per person; views saved in a browser
before this are pushed up the first time the inbox loads.
