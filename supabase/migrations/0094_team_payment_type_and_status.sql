-- The old wizard's "Payment & Work Type" step let a studio pick a top-level
-- classification (Monthly Salaried, Freelancer, Commission Based, Intern,
-- Contractor, or a studio-defined type) and then tick every pay component
-- that actually applies -- a base salary with a commission on top is a
-- normal arrangement here, and 0069's single payout_type enum can't
-- represent "both at once". payment_status is the lifecycle of THIS pay
-- arrangement (active/paused/ended), distinct from the person's own
-- active/inactive account status.
alter table users
  add column if not exists payment_type   text,
  add column if not exists pay_components text[] not null default '{}',
  add column if not exists payment_status text not null default 'active'
    check (payment_status in ('active', 'paused', 'ended'));

-- Studio-defined payment types go through the same custom_lookups mechanism
-- as expense categories and lead sources, under their own category so they
-- never mix with the *payment mode* (UPI/Cash/Bank transfer/...) values
-- already seeded under the 'payment_type' category (0084) -- a person's pay
-- classification and how a single payment was made are unrelated pickers
-- that happen to share an obvious English name. No default values are
-- seeded here: the five built-in types are hardcoded client-side (matching
-- how the old app never stored those as lookup rows either), so this
-- category starts empty and only grows when a studio adds one.
