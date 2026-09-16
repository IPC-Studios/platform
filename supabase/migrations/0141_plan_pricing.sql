-- The studio's actual pricing, and the columns the plan cards need.
--
-- `plans` has been empty since the rebuild started, so /settings/subscription
-- has honestly reported "No plans are on offer yet" and nothing in the app can
-- create one -- publishing a plan is a platform act, not a studio act. These
-- are the three plans the old app sells, at the prices it sells them for.
--
-- Two shape problems had to be fixed first. `billing_interval` allowed only
-- monthly and yearly, so the 2-year plan could not be stored at all; and the
-- card wants a badge, a savings line and a monthly-equivalent figure, which
-- had nowhere to live. activate_subscription already prefers `duration_days`
-- over the interval (0131), so a 730-day plan extends correctly whatever the
-- interval says.

-- ── the 2-year interval ──────────────────────────────────────────────────
alter table plans drop constraint if exists plans_billing_interval_check;
alter table plans add constraint plans_billing_interval_check
  check (billing_interval in ('monthly', 'yearly', 'biennial'));

-- ── what a plan card shows ───────────────────────────────────────────────
-- Kept as real columns rather than more keys inside `features`: `features` is
-- the list of included lines, and burying typed values in the same jsonb is
-- how the old app ended up parsing badges out of a bag of unknowns.
alter table plans add column if not exists sort_order int not null default 100;
alter table plans add column if not exists badge text;
alter table plans add column if not exists billing_label text;
alter table plans add column if not exists savings_label text;
alter table plans add column if not exists monthly_equivalent numeric(12, 2);

-- ── the plans ────────────────────────────────────────────────────────────
-- Prices are ex-GST; checkout adds 18%, which is what `gst_label` said on the
-- old card and what our invoice maths already does.
--
-- Idempotent on `key`, so re-running this file (the test suite does) updates
-- rather than duplicates, and a price change later is a one-line edit here.
insert into plans (
  key, name, description, price, currency, billing_interval, duration_days,
  sort_order, badge, billing_label, savings_label, monthly_equivalent, features, is_active
)
values
  ('ipc_monthly', 'IPC Monthly', 'Billed monthly. Cancel anytime.',
   1999, 'INR', 'monthly', 30, 100,
   null, 'Billed monthly', null, 1999,
   jsonb_build_array(
     'All Studio modules included',
     'Unlimited projects, shoots & team',
     'Email & in-app support'
   ), true),

  ('ipc_yearly', 'IPC Yearly', 'Best balance of price and flexibility.',
   18000, 'INR', 'yearly', 365, 110,
   'Most Popular', 'Billed yearly', 'Save ₹5,988/year vs monthly', 1500,
   jsonb_build_array(
     'Everything in Monthly',
     'Save ₹5,988 vs 12 months of monthly',
     'Priority support'
   ), true),

  ('ipc_2year', 'IPC 2-Year', 'Maximum savings for committed studios.',
   30000, 'INR', 'biennial', 730, 120,
   'Maximum Savings', 'Billed every 2 years', 'Save ₹17,976 vs 24 months of monthly', 1250,
   jsonb_build_array(
     'Everything in Yearly',
     'Lock the lowest effective rate',
     'Dedicated onboarding & priority support'
   ), true)
on conflict (key) do update set
  name               = excluded.name,
  description        = excluded.description,
  price              = excluded.price,
  currency           = excluded.currency,
  billing_interval   = excluded.billing_interval,
  duration_days      = excluded.duration_days,
  sort_order         = excluded.sort_order,
  badge              = excluded.badge,
  billing_label      = excluded.billing_label,
  savings_label      = excluded.savings_label,
  monthly_equivalent = excluded.monthly_equivalent,
  features           = excluded.features,
  is_active          = excluded.is_active,
  updated_at         = now();
