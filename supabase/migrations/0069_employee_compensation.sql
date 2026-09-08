-- Lovable parity: the old employee wizard captured a full pay structure --
-- payout type (salaried vs. paid per shoot/day/project), a commission on top
-- of it, a stipend, and the date range it's in effect for. The rebuild
-- reduced this to a single flat `salary`, which cannot represent a freelancer
-- paid per shoot with a commission on top -- a normal arrangement in a
-- photography studio's crew.
--
-- Added as columns on `users` rather than a new table: `salary` already
-- lives there as a flat figure, and every one of these is another fact about
-- the same person's pay, not a new entity with its own lifecycle. A
-- shoot-by-shoot payout LEDGER already exists separately (team_payouts,
-- 0059) -- this is the RULE that ledger is filled in from, not a duplicate
-- of it.
alter table users
  add column if not exists payout_type      text check (payout_type is null or payout_type in ('salary', 'per_shoot', 'per_day', 'per_project', 'custom')),
  add column if not exists commission_pct   numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  add column if not exists commission_basis text check (commission_basis is null or commission_basis in ('revenue', 'payment', 'profit', 'manual')),
  add column if not exists stipend_amount   numeric(12,2) check (stipend_amount is null or stipend_amount >= 0),
  add column if not exists pay_effective_from date,
  add column if not exists pay_effective_to   date check (pay_effective_to is null or pay_effective_from is null or pay_effective_to >= pay_effective_from),
  add column if not exists compensation_notes text check (compensation_notes is null or char_length(compensation_notes) <= 2000);
