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
