# IPC Studios

A multi-tenant SaaS ERP for photography/creative studios (India). One studio =
one tenant. Covers the whole studio lifecycle: **leads → clients → projects →
shoots & team allocation → data custody → tasks/production → work delivery →
invoicing (GST) → expenses & profit → payroll/attendance**, gated by a paid
subscription.

Rebuilt from scratch following the blueprint in `docs/`. Identity is **Supabase
Auth + RLS** (no Firebase). All 16 build phases are complete.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/IPC-Studios/platform)

> **Heads up:** the button deploys the **Cloudflare** pieces only. There is **no
> one-click for the database** — you must create a Supabase project and push the
> migrations first (see [Quick deploy](#quick-deploy)). The app boots broken
> until the DB exists and secrets are set.

---

## Architecture

| Layer | Tech |
|---|---|
| Frontend | React 19, TanStack Router + Query, Tailwind 4, Radix, dnd-kit |
| API | Hono on Cloudflare Workers (one router per domain) |
| Database | Supabase Postgres, **RLS as the primary enforcement** |
| Auth | Supabase Auth (JWT) |
| Payments | Razorpay (server-priced, HMAC-verified, idempotent activation) |
| Shared | `@ipc/contracts` (zod), `@ipc/permissions`, `@ipc/domain` (pure business rules) |

Three rules hold the design together: **one contract per endpoint** (zod, shared
client+server), **one permission registry** (imported by both sides), and **pure,
tested domain functions** for all money/tax/profit/slot/geo/template logic.

### Monorepo layout

```
apps/web/            React SPA (Vite)
services/api/        Hono API (Cloudflare Worker)
packages/
  contracts/         zod schemas = the single source of every request/response
  permissions/       module registry + profiles + resolver (both sides import)
  domain/            money, GST, invoice, profit, slots, geofence, template…
supabase/
  migrations/        0001–0017 (schema, RPCs, RLS)
  tests/             pglite migration + logic suite
docs/                RUNBOOK.md + the reverse-engineering spec
```

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Node](https://nodejs.org) ≥ 20 (some tooling)
- [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker (for local DB)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (deploy)

---

## Local development

```bash
bun install
```

Copy env and fill in values:

```bash
cp .env.example apps/web/.env
```

### Run the database (Supabase local)

```bash
supabase start          # boots Postgres + Auth + Studio (Docker)
supabase db reset       # applies all migrations in supabase/migrations
```

Put the printed `anon key` + API URL into `apps/web/.env`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

### Run the web app

```bash
bun run dev             # Vite dev server on http://localhost:5173
```

### Run the API worker

```bash
cd services/api && bun run dev   # wrangler dev
```

### UI preview without a database

To browse the whole authenticated UI with no backend, set `VITE_MOCK=1` in
`apps/web/.env`. A fake owner session + canned data render every screen. This is
**dev-only** (guarded by `import.meta.env.DEV`) and never ships.

---

## Quality gates

```bash
bun run typecheck       # tsc --noEmit across all workspaces (strict)
bun run lint            # eslint
bun run test            # vitest — domain, permissions, pglite migration suite
```

CI (`.github/workflows/ci.yml`) runs all three on every push/PR.

> **DB verification note.** The pglite suite validates SQL logic + RPCs but runs
> as superuser, so it does **not** prove RLS enforcement or the GiST
> double-booking constraint. Run those against a real Postgres before production
> — steps in [docs/RUNBOOK.md](docs/RUNBOOK.md).

---

## Quick deploy

The fastest path — order matters (**database first**):

```bash
# 1. Database — create a project at supabase.com, then:
bun run db:link -- --project-ref <your-project-ref>
bun run db:seed          # push migrations + seed (supabase db push --include-seed)

# 2. API (Cloudflare Worker) — set secrets once (see list below), then:
bun run deploy:api

# 3. Web (Cloudflare Pages):
VITE_SUPABASE_URL=<url> VITE_SUPABASE_ANON_KEY=<anon> VITE_API_BASE_URL=https://<worker>/ \
  bun run deploy:web
```

The **Deploy to Cloudflare** button at the top provisions the Worker/Pages from
this repo and wires push-to-deploy — but it's a private monorepo, so you'll pick
the subdirectory (`services/api` / `apps/web`) and add secrets in the Cloudflare
dashboard. The `bun run` commands above are the reliable path.

> There is **no Supabase deploy button** — nothing can one-click apply 17
> migrations + seed from a link. `bun run db:seed` is the closest, and it still
> needs you to create the project first.

---

## Deployment (detailed)

Three independent deploys: **database → API → web**.

### 1. Database (Supabase)

Create a project at [supabase.com](https://supabase.com), then link + push:

```bash
supabase link --project-ref <your-project-ref>
supabase db push                       # applies supabase/migrations to the cloud DB
```

Seed the plans/states catalogue as needed (see `supabase/seed.sql`). Set
`companies.plan_expiry` (or `grandfathered_until`) for any imported studios so
they aren't locked out.

### 2. API (Cloudflare Worker)

Config lives in `services/api/wrangler.jsonc`. Set secrets (never committed):

```bash
cd services/api
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put CRON_SECRET
wrangler secret put RAZORPAY_KEY_ID
wrangler secret put RAZORPAY_KEY_SECRET
wrangler secret put RAZORPAY_WEBHOOK_SECRET
wrangler secret put ALLOWED_ORIGINS        # e.g. https://app.yourstudio.com
wrangler deploy
```

Point external webhooks at the deployed worker:
- Razorpay → `POST https://<worker>/webhooks/razorpay`
- Meta Lead Ads → `POST https://<worker>/webhooks/lead/<source_key>`
  (verify GET → `https://<worker>/webhooks/meta`)

### 3. Web (Cloudflare Pages)

Build the SPA and deploy `dist/`:

```bash
cd apps/web
VITE_SUPABASE_URL=<prod-url> \
VITE_SUPABASE_ANON_KEY=<prod-anon> \
VITE_API_BASE_URL=https://<worker>/ \
bun run build
wrangler pages deploy dist --project-name ipc-studios
```

Set the same `VITE_*` values in the Pages project's build environment for CI
builds. **Do not** set `VITE_MOCK` in production.

### 4. Cron

Schedule a daily call to the reminder job (Cloudflare Cron Trigger, GitHub
Action, or `pg_cron` + `pg_net`):

```bash
curl -X POST https://<worker>/cron/reminders -H "x-cron-secret: $CRON_SECRET"
```

The secret is compared in constant time; the job is idempotent and records every
run in `cron_runs`. Add `?dry=1` to preview.

---

## Security posture

- **RLS** on every tenant table, scoped to `get_current_company_id()`.
- No plaintext credentials stored (the original's `shared_password` was dropped).
- Client links store only a **sha256 hash** of the token; raw value returned once.
- Payments: server-side pricing, HMAC signature verification, idempotent
  activation, replay-proof webhook ledger.
- Security headers + env-allowlisted CORS + best-effort rate limiting on
  unauthenticated surfaces.

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for secrets, rotation, incident response,
and the outstanding real-Postgres RLS verification.

---

## License

Private. © IPC Studios.
