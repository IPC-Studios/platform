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

**This table was last true on 2026-09-07.** A live side-by-side browse of both apps on 2026-09-11
(logged into each, not read from source) found rows 4–12 below all already shipped since — see
[[old-vs-new-live-audit-2026-09-11]] in memory for the walkthrough. Row 13 was always a deliberate
non-issue. Treat this whole table as historical; the current backlog is the "Still open" list
underneath it.

Ordered roughly by how much a studio would miss it. Sizes are rough: S = a screen, M = a screen
plus endpoints, L = schema + endpoints + several screens.

| # | Area | Original size | Size here | Notes |
|---|---|---|---|---|
| ~~1~~ | ~~Quotation flow~~ | done | | Snapshot, public page, accept/decline with evidence. |
| ~~2~~ | ~~Payment receipt~~ | done | | Public page, prints. |
| ~~3~~ | ~~Client delivery page~~ | done | | Public page behind the approved-work token. |
| ~~4~~ | ~~Enquiries~~ | done | | Own page, distinct from CRM leads, now with a studio-editable status picklist too. |
| ~~5~~ | ~~Reminders~~ | done | | Own page, manual + cron-generated. |
| ~~6~~ | ~~Personal expenses~~ | done | | Own page alongside company expenses. |
| ~~7~~ | ~~Team payouts~~ | done | | Own page, shoot-derived tracker + settlement ledger. |
| ~~8~~ | ~~Project documents~~ | done | | Own page under Projects. |
| ~~9~~ | ~~Referrals / refer-a-friend~~ | done | | Own page. |
| ~~10~~ | ~~Facebook lead ads screens~~ | done | | Real webhook integration (signed posts, Graph API fetch) — ahead of the original, which has this paused on its own account. |
| ~~11~~ | ~~Settings: services, lookups, task bundles, project templates, work submissions, attendance location, customisation, advanced~~ | done | | Everything is present, just consolidated into fewer tabs/relocated to the owning feature page instead of 13 separate ones — confirmed nothing was actually dropped, only reorganized. |
| 12 | Team hub sub-pages | 10 routes | M | Ours are folded into fewer screens. Deliberate, not revisited. |
| 13 | Detail/edit route splits | ~30 routes | M | They split `index`/`edit`/`$id`; ours combine. Cosmetic unless deep-linking matters. |

## Still open (as of 2026-09-16)

| Area | Notes |
|---|---|
| _(nothing tracked)_ | The Conflicts row below was closed on 2026-09-16. Open **decisions** are listed under it. |

### Closed since

| Area | Notes |
|---|---|
| Team Booking → Conflicts | Was listed as open on 2026-09-14 and had since been built: severity (Critical/Warning/Info), type, date-range and search filters, all rendered and applied. Closing it found a real bug — the five tiles counted every conflict while the list was narrowed by a date range defaulting to the next 30 days, so they disagreed before anyone touched a filter. The tiles now describe the same window, with severity and type as the drill-down within it. |

## Open decisions (not work — these need a call from the studio)

| Question | Why it is not mine to make |
|---|---|
| `/hr/attendance/auto-check-in` | The endpoint exists and nothing calls it. Checking someone in from their location without them pressing anything is a decision about tracking staff, not a gap to close quietly. |
| Drop `team_payout_settlements`? | The superseded per-user payout ledger (0143). Nothing reads or writes it and both tables are now commented, but a table drop cannot be undone by a migration. |
| Plan pricing | Published on 2026-09-16 from the old app's own seed (₹1,999 / ₹18,000 / ₹30,000 ex-GST). Change it in `0141_plan_pricing.sql` if those are not the intended prices. |

## Done since 2026-09-11 (not yet folded into the table above)

| Area | Notes |
|---|---|
| Data Management | Rebuilt: 5 stat tiles (Missing/Primary pending/Backup pending/Ready/At risk), status/project/type/search filters, CSV export, and a Storage Locations manage dialog. The backend table (`storage_locations` + the FK columns) already existed since migration 0009 — it just needed the API and UI wired up, no migration required. |
| Team Booking → Dashboard | Was 4 bare tiles; now the full 11 (Shoots/Roles needed/filled/Pending/Unassigned shoots/Conflicts/Active members/Booked/Available/Released/Cancelled) plus Booked cost, Status/Role/Search filters, a Book-slot action, and an Open-calendar link. |
| Project detail page | Was 3 tabs (Overview/Deliverables/Billing); now 9 (added Shoots, Completed Work, Terms, Expenses, Tasks, Data — all genuinely project-filtered, not link-outs). Deliverables tab also gained the colorful live-status system (pending/in_progress/completed/cancelled) the original has. |

## How to work through it

One area per batch: schema → contracts → API → UI → verify in the browser → commit. Tick the row
here when it lands. Anything that needs a product decision (file storage, whether enquiries are
separate from leads) gets asked before it is built, not after.
