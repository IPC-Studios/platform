# Parity with the original app

The zip in `IPC Studios.zip` is the app this repo is a rebuild of. This file tracks, screen by
screen, how far the rebuild has got — so "match the original" is a list somebody can work through
rather than a feeling.

**Counts, as of 2026-09-07.** Original: 117 route files, 642 source files, ~26k lines of frontend,
360 Supabase edge functions, 93 tables. This repo: 37 route files, 159 source files, ~28k lines,
~25 Hono routers, 41 migrations.

## What is deliberately not copied

These were decided when the rebuild started (2026-08-07) and are not open questions:

| Original | Here | Why |
|---|---|---|
| Firebase Auth | Own JWT + Postgres RLS | "Simplify auth." Firebase dropped entirely. |
| 359 edge functions | ~25 domain routers | One function per action was rejected as unmaintainable. |
| `deliverables` + `deliverables_2` | One `deliverables` table with `list_key` | The legacy split was a mistake being carried forward. |
| Role stage in `localStorage` | `employee_roles.stage` column | Their own code called this a workaround. |

Matching the *screens* is the goal. Matching the *architecture* would undo the rebuild.

## Done

| Area | Notes |
|---|---|
| Auth, register, verify, reset, invite | Ours goes further: refresh tokens, session revocation. |
| Clients, projects, project detail | Plus a create-project wizard the original does not have. |
| Shoots | Card per shoot, requirements, map link, internal work. |
| Deliverables | Three lists, saved sets, lead-time memory. |
| Tasks, production board | dnd-kit board, bundles. |
| Team allocation | GiST constraint stops double-booking. |
| Team directory, roles | Role library, stages, assignment. |
| Team terms | Templates, 11-draft library, sends, public acknowledgement. |
| Billing, invoices, payments, expenses, financials | GST engine is ours. |
| CRM, follow-ups, lead sources | Remote `main` added CRM v2–v4. |
| Attendance, HR | Geofencing. |
| Notifications, cron | |
| Subscription, Razorpay | |
| Platform console | Not in the original at all. |

## Missing — the actual backlog

Ordered roughly by how much a studio would miss it. Sizes are rough: S = a screen, M = a screen
plus endpoints, L = schema + endpoints + several screens.

| # | Area | Original size | Size here | Notes |
|---|---|---|---|---|
| ~~1~~ | ~~Quotation flow~~ | done | | Snapshot, public page, accept/decline with evidence. |
| ~~2~~ | ~~Payment receipt~~ | done | | Public page, prints. |
| ~~3~~ | ~~Client delivery page~~ | done | | Public page behind the approved-work token. |
| 4 | Enquiries | 2 routes, 10 components | L | Distinct from CRM leads in the original. |
| 5 | Reminders | 1 route, 12 components | M | Cron writes notifications already. |
| 6 | Personal expenses | 4 routes, 13 components | L | Company expenses exist; per-person ones do not. |
| 7 | Team payouts | 1 route, 2 components | L | Payroll/settlement. |
| 8 | Project documents | 1 route | M | File storage — needs a bucket decision first. |
| 9 | Referrals / refer-a-friend | 3 routes | M | |
| 10 | Facebook lead ads screens | 2 routes, 8 components | M | Meta webhook exists in the API since CRM v2. |
| 11 | Settings: services, lookups, task bundles, project templates, work submissions, attendance location, customisation, advanced | 13 routes | L | We have 6 settings tabs; they have 13. |
| 12 | Team hub sub-pages | 10 routes | M | Ours are folded into fewer screens. |
| 13 | Detail/edit route splits | ~30 routes | M | They split `index`/`edit`/`$id`; ours combine. Cosmetic unless deep-linking matters. |

## How to work through it

One area per batch: schema → contracts → API → UI → verify in the browser → commit. Tick the row
here when it lands. Anything that needs a product decision (file storage, whether enquiries are
separate from leads) gets asked before it is built, not after.
