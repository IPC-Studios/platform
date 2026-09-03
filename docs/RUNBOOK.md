# IPC Studios — Operations Runbook

## Environments & secrets

Backend secrets live in the repo-root `.env` on the VPS (gitignored); the web
app's are Cloudflare Pages env vars. Never commit them. `deploy/.env.example`
lists every variable.

| Secret | Where | Rotation |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` (db superuser) | Change in Postgres, then `.env`, then `up -d` |
| `DB_AUTHENTICATOR_PASSWORD` | `.env` (role the API logs in as) | The `migrate` service re-applies it on every deploy |
| `JWT_SECRET` | `.env` | Rotating it logs **everyone** out (all access + refresh tokens) |
| `CRON_SECRET` | `.env` (API + cron service, same file) | Rotate both sides together |
| `RESEND_API_KEY` | `.env` | Rotate in Resend → `up -d api` |
| `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | `.env` | Rotate in Razorpay dashboard → `up -d api` |
| `BACKUP_S3_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` | `.env` | Scoped to the backup bucket; rotate in the storage provider |
| `ALLOWED_ORIGINS` | `.env` | Comma-separated prod origins; empty = allow-all (dev only) |

## Cron

`pg_cron` (or an external scheduler) calls `POST /cron/reminders` with header
`x-cron-secret: $CRON_SECRET`. The secret is compared in **constant time**.
Add `?dry=1` for a no-op dry run. Every run is recorded in `cron_runs`
(queryable for idempotency + observability). Generators de-dupe, so re-running
is safe.

## Rate limiting

`services/api/src/middleware/security.ts` applies a per-IP sliding window to
`/auth`, `/public`, `/webhooks`. On the single long-lived Bun process this is a
real limiter. Running more than one API replica needs a shared store (Redis) —
until then the window is per-process.

## RLS is the primary enforcement (Fork 1 = B)

Every tenant table has `company_id` and an RLS policy scoped to
`get_current_company_id()`. The API connects as the unprivileged `authenticator`
role and `SET ROLE`s to `authenticated` per request with the caller's id in a
GUC, so the database — not application code — is what keeps studios apart.

## DB verification

Two layers:

- **Logic**: `@electric-sql/pglite` in `supabase/tests/tenancy.test.ts` and the
  other pglite suites. pglite runs as superuser, so it proves SQL correctness but
  **cannot** prove RLS enforcement.
- **Enforcement**: `supabase/tests/rls-live.mjs` against a real Postgres. It
  registers two throwaway studios over HTTP and asserts studio A cannot read
  studio B's company / clients / users, plus the auth and password-reset paths.
  The CI `e2e` job runs it on every push against a `postgres:16` service, so this
  is verified continuously rather than as a pre-launch ritual.

Run it against any environment:

```bash
API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs
```

It creates two disposable tenants each run — clean them up periodically. The
GiST double-booking constraint applies automatically on real Postgres (pglite
lacks `btree_gist`, so its overlap trigger is the fallback there).

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

- 500s carry an `X-Correlation-Id` header + a structured JSON log line — grep
  logs for the id the user reports.
- Payment disputes: `payment_orders`, `payment_transactions`,
  `razorpay_webhook_events` (replay-proof), `billing_events` are the audit trail.
- Access disputes: `access_audit_logs` records every `set_user_access`.

## Security posture notes

- No plaintext credentials are stored (the original's `employees.shared_password`
  was intentionally dropped in the rebuild).
- Provider tokens: encrypt at rest before storing (not yet holding any).
- Client links (`work_delivery`, `terms_ack`) store only a **sha256 hash** of
  the token; the raw value is returned once.
