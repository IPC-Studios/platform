-- Five SECURITY DEFINER functions that nothing calls, and one table nothing
-- writes to.
--
-- Each was superseded by a path that works, and each was left behind still
-- granted to `authenticated`. That is privileged, unreviewed surface no test
-- covers — and worse, `settle_payout` writes `team_payout_settlements` while
-- the live path writes `team_slot_settlements`. Two tables whose names differ
-- by one word, for the same idea, is how a future "record a payout
-- adjustment" lands in the wrong one and the money quietly disagrees.
--
-- What replaced each, verified by grepping the API and every migration body
-- for a call site (there are none for any of these):
--
--   apply_task_bundle_to_project -> apply_task_bundle()        (tasks router)
--   create_project_template      -> a direct insert            (projects router)
--   create_referral_campaign     -> a direct insert            (referrals router)
--   settle_payout                -> create_payout_settlement() (0090)
--   payout_balance               -> list_payout_settlements()  (0090)
--
-- The functions go. `team_payout_settlements` stays: dropping a table is not
-- reversible by a migration, and while nothing has ever written to it, that
-- is a claim about this repository rather than about every database out
-- there. It is commented instead, so the next person reading the schema knows
-- within one line which of the two ledgers is real.

drop function if exists apply_task_bundle_to_project(uuid, uuid, uuid[], date);
drop function if exists create_project_template(text, text, jsonb, jsonb, jsonb);
drop function if exists create_referral_campaign(text, text, text, numeric, text);
drop function if exists settle_payout(uuid, numeric, text, text, text);
drop function if exists payout_balance(uuid);

comment on table team_payout_settlements is
  'SUPERSEDED (0143). The per-user credit/debit ledger from 0014. Nothing '
  'reads or writes it; team payouts settle per booking slot through '
  'create_payout_settlement() into team_slot_settlements. Kept only because a '
  'table drop cannot be undone — do not wire anything new to it.';

comment on table team_slot_settlements is
  'The live payout ledger: one row per payment against a booking slot, '
  'written by create_payout_settlement() (0090) and read by '
  'list_payout_settlements(). Not to be confused with the superseded '
  'team_payout_settlements.';

-- ── Three more the same sweep found, once trigger-attached functions were
-- ── discounted. All superseded, none broken:
--
--   crm_apply_automations  -> crm_enroll_workflows(). 0047 replaced the row
--     trigger deliberately — its own comment reads "the row trigger now
--     enrolls workflows instead of applying rules" — and the v3 rule engine
--     has had no caller since. The crm_automations table it read is not
--     referenced by the API or the web app either.
--   update_work_submission -> the work router updates the row directly.
--   mark_work_client_sent  -> POST /work/submissions/:id/deliver's sibling,
--     /client-sent, sets the same three columns inline.
--
-- The 0076 signature is dropped too: 0104 replaced that function with a
-- wider one, and `create or replace` cannot change an argument list, so both
-- overloads have been sitting in the schema since.
drop function if exists crm_apply_automations(uuid, text, text);
drop function if exists update_work_submission(uuid, text, text, text);
drop function if exists update_work_submission(
  uuid, text, text, text, text, text, text, text, text, text, text, text, boolean);
drop function if exists mark_work_client_sent(uuid, text);
