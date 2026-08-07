# IPC Studios — Operations Runbook

## Environments & secrets

Secrets are set via `wrangler secret put` (API) and Cloudflare Pages env (web).
Never commit them. `.env.example` lists every variable.

| Secret | Where | Rotation |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | API worker | Rotate in Supabase → update secret → redeploy |
| `SUPABASE_ANON_KEY` | API + web | Public; rotate with project keys |
| `CRON_SECRET` | API + cron scheduler | Rotate both sides together |
| `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | API | Rotate in Razorpay dashboard → update secret |
| `ALLOWED_ORIGINS` | API | Comma-separated prod origins; empty = allow-all (dev only) |

## Cron

`pg_cron` (or an external scheduler) calls `POST /cron/reminders` with header
`x-cron-secret: $CRON_SECRET`. The secret is compared in **constant time**.
Add `?dry=1` for a no-op dry run. Every run is recorded in `cron_runs`
(queryable for idempotency + observability). Generators de-dupe, so re-running
is safe.

## Rate limiting

`services/api/src/middleware/security.ts` applies a best-effort per-IP sliding
window to `/auth`, `/public`, `/webhooks`. **This is per-isolate only.** For
real multi-instance limiting, back it with Cloudflare KV or a Durable Object
keyed on `IP:path`.

## RLS is the primary enforcement (Fork 1 = B)

Every tenant table has `company_id` and an RLS policy scoped to
`get_current_company_id()`. **RLS enforcement is validated by the pglite suite
for logic, but pglite runs as superuser and cannot prove enforcement.** Before
production, run the RLS suite against a real Postgres/Supabase with the
`authenticated` role (see "DB verification" below).

## DB verification (outstanding)

Migrations `0001`–`0017` are applied + logic-tested via `@electric-sql/pglite`
in `supabase/tests/tenancy.test.ts`. To prove RLS enforcement + the GiST
double-booking constraint (pglite lacks `btree_gist`):

1. `supabase start` (Docker) or point at a hosted project.
2. `supabase db reset` to apply all migrations.
3. Run an RLS suite as `authenticated` with a JWT `sub` claim, asserting
   cross-tenant reads return zero rows.

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
