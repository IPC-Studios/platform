# Live parity: the old app vs this one

Built by walking both **deployed** apps and fingerprinting every screen — the
tabs, wizard steps, field names, table columns and actions a user can actually
reach. Not a code comparison.

- Old: `https://ipcstudio.lovable.app`
- Ours: `https://ipc-web.dev-d9b.workers.dev`

Re-run: inject `docs/parity-fingerprint.js` into each app, walk the routes,
`navigator.clipboard.writeText(JSON.stringify(capture))` to get the result out
(reading it back through the tooling truncates; the clipboard does not, and the
page must be focused first), then `python docs/parity-diff.py old.json new.json`.

## Why this file exists

Earlier passes checked whether a route or endpoint *existed*. That finds what is
absent outright and is blind to a screen that exists but offers a fraction of
the original — which turned out to be the common case. The project editor was
226 lines against 853 **and crashed on load**; the Terms tab is one button where
the old app has a three-step document wizard with a live preview.

Existence is not equivalence.

## What the harness gets wrong, and how it was corrected

Worth reading before trusting a number. The first version was **systematically
biased against our app** and invented gaps that did not exist:

| Flaw | Effect | Fix |
|---|---|---|
| Read `<label>` text only | Our filters use `aria-label`, so search and date filters read as missing | Fingerprint resolves the full accessible name |
| Read `<button>` text only | Our row actions are icon-only, so View/Edit/Delete read as missing | Same |
| Compared full action labels | Ours say "Delete Priya Sharma", theirs say "Delete" | Reduce leading verbs |
| Counted nav and settings sidebars | Every settings sub-page looked ~75% missing | Items on 5+ screens of an app are treated as chrome |
| Summed missing per kind | One control counted twice, percentages passed 100% | Dedupe across kinds |

`/clients` first reported 13 missing items. After the fixes: **2**, and both
real. That is the correction factor to keep in mind for unverified rows.

Two sources of noise remain, so **every row still needs eyes before it becomes
work**:

- **Data, not features.** "Deactivate Facebook" on the lookups screen is one of
  their seeded rows, not a control we lack.
- **Rendering.** The old app keeps every wizard step in the DOM at once and
  hides inactive ones with CSS; we mount one at a time. A single snapshot of
  their create-project wizard therefore shows fields ours has not mounted.

## Ranked

| old screen | ours | items | missing | % | status |
|---|---|---:|---:|---:|---|
| `/production-board` | `/production-board` | 25 | 22 | 88% | verified — real |
| `/follow-ups` | `/follow-ups` | 26 | 20 | 77% | unverified |
| `/financials/profit` | `/financials/profit` | 17 | 17 | 100% | unverified |
| `/settings/company` | `/settings` | 16 | 16 | 100% | unverified |
| `/settings/advanced` | `/settings/advanced` | 17 | 16 | 94% | unverified |
| `/team-payouts` | `/team-payouts` | 12 | 11 | 92% | unverified |
| `/data-management` | `/data-management` | 13 | 11 | 85% | unverified |
| `/dashboard` | `/dashboard` | 14 | 10 | 71% | unverified |
| `/settings/team-terms` | `/settings/team-terms` | 9 | 9 | 100% | unverified |
| `/attendance` | `/attendance` | 14 | 8 | 57% | unverified |
| `/project-tracking` | `/project-tracking` | 19 | 8 | 42% | unverified |
| `/employees` | `/employees` | 20 | 8 | 40% | unverified |
| `/shoots` | `/shoots` | 9 | 7 | 78% | unverified |
| `/clients` | `/clients` | 11 | 7 | 64% | verified — mostly ours already |
| `/reminders` | `/reminders` | 6 | 6 | 100% | unverified |
| `/settings/roles` | `/settings/roles` | 5 | 5 | 100% | unverified |
| `/settings/project-templates` | `/project-templates` | 5 | 5 | 100% | unverified |
| `/billing` | `/billing` | 8 | 5 | 62% | unverified |
| `/settings/subscription` | `/subscription` | 4 | 4 | 100% | unverified |
| `/notifications` | `/notifications` | 7 | 4 | 57% | unverified |
| `/enquiries` | `/enquiries` | 8 | 4 | 50% | unverified |
| `/settings/attendance-location` | `/settings/attendance-location` | 5 | 3 | 60% | unverified |
| `/settings/theme` | `/settings/appearance` | 6 | 3 | 50% | unverified |
| `/team-allocation` | `/team-allocation` | 7 | 3 | 43% | unverified |
| `/personal-expenses` | `/personal-expenses` | 8 | 3 | 38% | unverified |
| `/facebook` | `/lead-sources` | 2 | 2 | 100% | unverified |
| `/referrals` | `/referrals` | 2 | 2 | 100% | unverified |
| `/financials/gopo` | `/financials/gopo` | 5 | 2 | 40% | unverified |
| `/tasks` | `/tasks` | 10 | 2 | 20% | unverified |
| `/financials` | `/financials` | 1 | 1 | 100% | unverified |
| `/platform/studios` | `/platform/studios` | 1 | 1 | 100% | capture empty — recheck |
| `/project-documents` | `/project-documents` | 3 | 1 | 33% | unverified |
| `/company-expenses` | `/company-expenses` | 5 | 1 | 20% | unverified |
| `/projects` | `/projects` | 11 | 1 | 9% | unverified |

**At parity or better:** `/my-work`, `/settings/lookups`, `/settings/task-bundles`, `/platform/usage`

## Multi-step pass: the wizards

The deepest level — walking each multi-step flow step by step on both apps.

| Flow | Old | Ours | Outcome |
|---|---|---|---|
| Create project | 5 steps: Project & Client, Shoots, Deliverables, Billing, Review | same 5, same order | parity, plus Discard, per-shoot remove and status |
| Add team member | 6 steps: Engagement, Login, Contact, Role, Details, Review | same 6, same order | parity |
| Invoice | Save Draft / Save & Send, qty, tax %, line presets, bank/UPI | Status select (Draft/Sent), qty, gst_rate, line presets, bank details, terms, print layout, GSTIN | parity, plus import package/deliverables/balance from a project |

The shoot chips (Engagement, Haldi, Mehendi, Wedding Day, Reception, Couple
Shoot), the deliverable presets (Raw Photos, Edited Photos, Highlight Film,
Full Wedding Film, Reel, Teaser, Full Ceremony Video, Data Sorting, Quality
Check) and the three wedding packages all match name for name.

One shape difference kept: their invoice has **Save Draft** and **Save & Send**
as two buttons; ours has one Status select with the same two values. Same
capability, one fewer way to be confused about what was saved.

## Dialog pass: the add/edit forms

The level below tabs. Opening each app's primary "add" modal and comparing the
fields, which no earlier pass had done — every sweep until now only saw the
button that opens them.

| Dialog | Old | Ours | Outcome |
|---|---:|---:|---|
| Company expense | 3 fields | 11 | ours ahead |
| Personal expense | 6 | 10 | ours ahead |
| Reminder | — | 6 | ours ahead |
| Add lead | 18 | 12 | **closed** — added Assign to, Follow up at, Stage, Group/segment |
| Payment, data record | — | — | capture artifact; our buttons are named differently |

The lead form was the one real gap, and all four fields were already in
`createLeadRequest` — the dialog just never asked, so leads arrived unowned,
undated and untagged.

Not adopted from their lead form: **Quality** (hot/warm/cold) and **Contacted
status**. We use a continuous score and per-attempt activity history; carrying
both models would leave two sources of truth for one question.

## Inside-screen pass: the project tabs

Route-level sweeping runs out once the routes match. The next depth is the tabs
*within* a screen — ten on the project detail.

**A trap worth recording.** Driving the old app's tabs with `element.click()`
does nothing: its tab component listens on `pointerdown`/`mousedown`. The first
capture was therefore ten copies of the Overview tab, and the diff cheerfully
reported every tab "at parity". Dispatch a real pointer sequence
(`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`) instead. Ours
responds to a plain click, so the two apps disagree here and only one side
silently fails.

What the corrected pass found:

| Tab | Finding | Outcome |
|---|---|---|
| Shoots | read-only; "Add shoot" navigated away to the global page | **closed** — ten quick-add chips + full form, in place |
| Referrals | share link built `/refer/` and never appended the slug — a dead link in every copied message | **closed**, plus the reward block, WhatsApp and a Referrals-received list |
| Deliverables | ours is richer (scope grouping, per-item status, linked shoots); theirs has Import Work Deliverables and Add brief | open, low value |
| Tasks | ours has per-task status selects; theirs has a bulk-tools menu | open, low value |
| Overview, Expenses, Data, Completed Work | naming differences only | no work |

## Deep pass: fields, tags and cards

A third sweep extended the fingerprint past controls into the things a list
screen is mostly *made* of — status tags, the stat tiles across the top, and
the `<dt>` captions inside cards. It found four candidates. Three were the
harness again:

| Claimed | Reality |
|---|---|
| `/financials/profit` — Salaried Staff, Intern Stipends, Contractor Retainers, Commission Base tiles | All four render. Capture artifact. |
| `/team-payouts` — Mark Paid, Payment history, Due/Paid/Settlement | Mark paid and a settlement-history dialog both exist; ours renders cards where theirs renders a table. |
| `/shoots` — filters | Ours filters by search, status, date and sort; theirs by month, assignment, project and role. Different axes, not fewer. |

**Found, and now closed:**

- **Change lane colour** — seven tints per lane, saved per studio (`0130`)
- **Card details panel** — expands in place with description, full assignee
  list and status/priority changers

**Deliberately left:**

- **"Any data" filter** — needs a data-custody flag on tasks, which the schema
  does not carry. Building it would mean matching everything, and a filter that
  silently does nothing is worse than an absent one. Revisit if the flag lands.

Everything else on both apps now matches or is a deliberate divergence.

## Status: all verified rows are closed

| screen | finding | outcome |
|---|---|---|
| Project → Terms | real — whole authoring wizard absent | **closed** (`0129` + `TermsWizard`) |
| Project → Terms, step 3 | real — send screen was one button | **closed** (link, email draft, manual share, history) |
| Production board | real — KPI strip, 2 filters | **closed** |
| Clients | 2 of 13 reported items real | **closed** (Address, Added) |
| `/financials/profit` | capture artifact — ours has month/basis/allocation, per-project table with expandable variable, allocated and actual cost | no work |
| `/team-payouts` | capture artifact — settlement, status, member and date filters, search, settlements all present | no work |
| `/data-management` | capture artifact — status filter tabs, stat cards, CSV export present | no work |
| `/settings/team-terms` | capture artifact — categories, archived toggle, template library present | no work |
| `/settings/advanced` | noise — the rows are the settings nav and the dashboard setup-journey steps | no work |
| `/dashboard` | capture empty on our side; setup journey exists | recheck only |

The pattern holds: once a row is actually looked at, most of it evaporates.
`/clients` was 13 → 2. Treat any unverified number as an upper bound, not a
backlog.

### Deliberate divergence found while verifying

The old profitability table carries separate **Booked Revenue**, **Cash
Profit** and **Booked Profit** columns. Ours has one Profit column driven by
the cash/booked toggle, which is why the diff saw them as missing. Keeping
ours: two columns that can never both be relevant at once is a worse table.

## Verified

### Production board — real, and the clearest next job
Ours has Status / People / Data views and project, priority and assignee
filters. Missing against the old app:

- **Any due** and **Any data** filters, and an **Assigned + Unassigned** toggle
- Six lane KPI chips with counts and empty-state captions: Overdue, Due Today,
  Pending Review, In Progress, Completed, Needs Attention
- Per-card controls: **Change lane colour**, **Change priority**,
  **Change status**, and drag-to-move affordances

### Project -> Terms — the largest single gap
A three-step document wizard in the old app:

1. **Template & Payment Terms** — template picker, Apply template, Seed,
   Document title, six payment presets (`30/30/30/10`, `30/40/30`, `50/50`,
   `100% Advance`, `Retainer + Balance`, `Custom`), Advanced edit
2. **Terms & Conditions**
3. **Send to Client**

With a **live preview** that re-renders as you type, **Save draft**, **Generate
PDF**, a draft badge, and a branding-incomplete warning linking to Settings.

Ours: one **Issue terms** button and a list of sent documents with Resend.

### Clients — nearly ours already
Search, relation filter, sort, CSV, created-from/to date filters and row
view/edit/delete all exist. Genuinely absent: the **Address** and **Added**
columns.

## Deliberate divergences — not gaps

Ours is ahead in places, and closing "gaps" here would be a regression:

- Configurable CRM pipeline with stage kinds, against seven fixed statuses
- Continuous lead score against a three-state hot/warm/cold flag
- Per-attempt activity history against a single contacted field
- Richer tasks, roles and attendance screens

## Round: seeded live data (2026-09-15)

The rounds above compared empty screens. Seeding the deployed studio with real
clients, projects, shoots, crew bookings, tasks and expenses changed the
picture: several screens that had looked "thin but fine" were broken, and the
empty state was hiding it.

### Defects only real data exposed

| Screen | What was wrong |
| --- | --- |
| Company expenses | Every insert 400'd — `itemize_json: undefined`, which postgres.js rejects outright |
| Company expenses | The list returned nothing for any studio: `Number('')` is `0`, so a missing `max_amount` became `amount <= 0`. The summary tiles above it, which have no such clause, counted the same rows correctly |
| Personal expenses | The same `Number('')` line |
| Monthly profit | White "Something went wrong" — a `useMemo` below `if (isLoading) return` |
| Dashboard | Same shape: the employee branch returned before nine hooks |
| Monthly team cost | Grouped by `team_payouts.employment_type`, a column in no migration. A bare `catch` swallowed it and five ₹0 tiles rendered under a non-zero salary figure |
| GOPO dashboard | From/To pickers sent to an RPC that takes no parameters, under a caption claiming they filtered payments, expenses and activity |

None of these were visible to typecheck, lint or the 1449-test suite.
`react-hooks/rules-of-hooks` is now on for `apps/web` and caught both hook
bugs; `numberQuery()` replaces the `Number('')` pattern with a test;
`supabase/tests/monthly-profit.test.ts` runs the bucket SQL against every
migration and asserts the tiles reconcile with the figure above them.

### Gaps closed in this round

- **Data management** — counts on the filter chips, data-status and
  backup-status selects, a received-date range, and the how-to banner
- **Team payouts** — the note that the settlement ledger does not move project
  cost or profit. (The screen itself was already at parity; the "From shoots"
  tab simply had nothing in it before seeding)
- **Project tracking** — tasks / deliverables / data / overdue / review back on
  the row instead of one click away in the health breakdown
- **Billing** — an "Invoice settings" button. `/billing/templates` is a superset
  of the old Billing → Settings tab but was reachable only from a link inside
  the invoice form
- **How-to banners** on Clients, Company expenses and Billing → Payments

### Confirmed at parity once seeded

Team payouts (five KPIs, four filters, per-member grouping, Mark paid,
settlement history), Billing → Payments (five KPIs, chips, filters), CRM
(fourteen tabs against the old app's eleven), Task management, Dashboard
(the seven-step setup journey exists and is correctly hidden once complete).

### Divergence kept deliberately

The production board lanes stay four task statuses with the old app's seven
production buckets applied to deliverables, as the code comment records —
task rows carry no review or revision state to lane them by.

## Round: settings that were stored and read by nothing (2026-09-15)

Prompted by two reports — the Subscription page showing "This didn't load", and
the New lead source dialog's Kind dropdown changing nothing above it — this
round stopped spot-checking screens and built two scans instead.

### The scans

**Contract vs form.** Pull the top-level keys out of every `create*/update*`
request contract, then look for each key across `apps/web`: a key no file names
is a field the API accepts and no human can set; a key whose every assignment
site is a bare literal is fixed in code whatever the form appears to offer.
75 contracts, 4 real hits.

**SQL vs schema.** Build the schema by applying all migrations in pglite, then
resolve the FROM/JOIN aliases in all 827 SQL template literals in the API and
check each `alias.column`. A second pass catches unqualified columns in
single-table statements, which is the form the Subscription bugs took.

### What they found

| Where | What was wrong |
| --- | --- |
| Subscription | Both endpoints selected columns on no table — `plans.description/currency/duration_days`, `companies.plan_key/plan_name/plan_gate`, `users.plan_gate/plan_expiry`, `payment_orders.expires_at`. Every request 400'd |
| Lead sources | `source_type` hardcoded to `'website_form'`, so picking Meta lead ads created a web form. Five more fields the contract carries were on no screen |
| Expense receipts | `expense_attachments` was declared twice — 0119's `create table if not exists` did nothing against 0012's table, so the reader and writer both named columns that do not exist. A bare catch turned the read into "no attachments yet" |
| CRM automations | `severity`, `cooldown_hours`, `notify_assignee`, `notify_roles` all inert: notifications went to the assignee only, always at `info`, deduped per calendar day — so the seeded 2h/72h/168h cooldowns all behaved as 24h |
| Cadences | `stage_filter` and `source_filter` inert: a cadence written for Instagram started on a referral |
| Leads | `quality` (hot/warm/cold) stored, filterable and synced by a trigger, named by no screen |
| Tasks | The New task dialog sent `deliverable_id: null` outright |

### The rule this round follows

Wire the engine first, then the UI. A control for a setting nothing reads is
worse than no control — it is the GOPO date picker again. So 0133 and 0134
make the six CRM settings real, with `workflow-routing.test.ts` covering all
seven behaviours, and only then do the builders show them.

### Gates added

- `schema-drift.test.ts` — every `create table if not exists` is checked against
  the applied schema, so a redefinition that silently does nothing fails.
  Verified it fails without 0132 and names the table.
- `subscription.test.ts` — runs both of that screen's queries against every
  migration, and checks the gate it derives matches the access payload's.
- `monthly-profit.test.ts`, `params.test.ts` — from the previous round.

### Still open, needing a decision

The `plans` table is empty and nothing in the app can create a plan, so
Subscription correctly reports "No plans are on offer yet". Pricing is the
studio's call, not something to invent.

### A third scan: what the read path drops

Found by opening a seeded rule in the browser rather than by any scan — which
is why it is written down here.

The workflow editor showed "For information" over the "Hot lead has no
follow-up" rule, which 0105 seeds as `critical`, routed to admins.
`selectWorkflows` never selected `severity`, `cooldown_hours`,
`notify_assignee` or `notify_roles`, so the contract's defaults filled in on
read. The create path omitted them too. The PATCH path did write them — which
made it worse than cosmetic: opening that rule and saving it for any reason
would have written the defaults the form was showing back over its real
values, turning critical into info and dropping the routing.

**A field is only real when the READ path returns it.** A read schema field
carrying `.default()` or `.nullish()` absorbs a missing column in silence
instead of erroring, so the UI shows a plausible wrong value.

Scanning for the pattern — for every `X.parse(...)` in a router, check each
forgiving field of schema X appears in that file's SQL — returns 16 candidates
and no further real ones: `companyProfile` selects via a JS column array,
`publicReceipt`/`publicDelivery` come from the token RPCs repaired in 0126,
`crmUserPrefs` parses a jsonb blob, and `workflow.rule_key` is unused by the
web app. Too noisy to keep as a gate, so the durable protection is the
targeted assertion in `workflow-routing.test.ts` that pins the read query to
those four columns.

### Verified in the browser, on the deployed app

Subscription loads; the lead-source Kind dropdown swaps the fields above it;
the cadence builder shows both filters; the workflow editor reads the seeded
`critical` / admin routing; a lead created as Warm saves, shows Warm in the
drawer, and is the only row the inbox's Warm filter returns; the task
deliverable picker enables on project choice and lists that project's real
deliverables; data-management chip counts, both status filters and the date
range render; the project-tracking row carries its five figures.

## Round: the page-by-page crawl (2026-09-16)

A crawler that visits each screen and captures every button, tab, heading,
select and field — reading `aria-label` as well as text, because our icon
buttons carry their name there and the earlier harness could not see them.
Run against both apps and diffed route by route.

### Ours was ahead on

Employees (Directory/Salaries tabs, pagination, engagement/status/role
filters, Deactivate, Remove), Attendance (check in/out, My attendance, Set
location, Correct, a Late state), Roles & Access (a role library of defaults to
adopt), Project Tracking, Clients, Tasks, Production Board, and the CRM as a
whole — fourteen tabs against eleven.

### Gaps found and closed

| Where | What was missing |
| --- | --- |
| Project → Shoots | The whole planning surface. Rebuilt: per-requirement rows coloured by fill, Assign/Manage, role chips, crew progress, time on the card, assigned and data badges, inline edit, apply preset |
| Project → Deliverables | `description` (the old app's "Add brief") reachable by no form; no way to make a task from one deliverable |
| Project → Expenses | "Add expense" was a link to the global list — pressing it added nothing |
| Project → Terms | No Save draft: you finished in one sitting or lost the lot |
| CRM → Templates | No seeding, so every studio wrote its first enquiry reply from scratch |
| CRM → Reports | Date range only — no source or owner filter |
| Lead sources | No Meta portal checklist, only a list of unset server secrets |
| Settings | No contact details; phone/email/address lived only on the invoice templates page |
| Tasks | No explicit View action |
| Project → Allocation | Linked to a bare calendar, opening on a month with nothing in it |

### Traps worth remembering

- **A draft is newer than the document it came from.** The documents list takes
  one row per project, newest first, so an unfiltered list would let saving a
  draft hide the live document, its link and its acknowledgement state.
- **Two overloads both callable as `crm_stats(date, date)`** is an
  ambiguous-function error at call time. Adding defaulted parameters means
  dropping the old signature, and the test asserts one function remains.
- **`renderTemplate` fills an unknown `{{placeholder}}` with empty text.** A
  seeded template written against an invented variable ships "Hi , thanks for
  reaching out" and nothing reports it — so the seeds' placeholders are checked
  against what `crmTemplateVars` actually produces.
- **A blank filter value must mean "no filter"**, not a value literally equal
  to the empty string. Same family as the `Number('')` bug two rounds ago.

### Still to crawl

The client-facing document pages (quotation, receipt, delivery note, terms
acknowledgement, team terms) — reachable only by token, so they need a seeded
link per type rather than a logged-in session.
