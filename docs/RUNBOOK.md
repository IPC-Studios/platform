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

## DB verification

Migrations are logic-tested via `@electric-sql/pglite` in
`supabase/tests/tenancy.test.ts` (36 tests).

**RLS enforcement is VERIFIED on the real hosted Postgres** by
`supabase/tests/rls-live.mjs` — it registers two throwaway studios and asserts
studio A cannot read studio B's company / clients / users (direct PostgREST
with each JWT, and end-to-end through the API). Re-run anytime:

```bash
cd apps/web && \
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=sb_publishable_... \
API_URL=https://<worker>/ \
bun ../../supabase/tests/rls-live.mjs
```

It creates two disposable tenants each run — clean them up periodically. The
GiST double-booking constraint applies automatically on real Postgres (pglite
lacks `btree_gist`, so its overlap trigger is the fallback there).

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
