-- Delivering work that was not yet approved has never worked.
--
-- 0115 relaxed delivery on purpose: a studio can send a client the work while
-- it is still 'submitted', and the submission is then marked 'sent'.
--
--     update team_work_submissions
--        set status = case when status = 'submitted' then 'sent' else status end
--
-- The CHECK constraint was never widened to match. It still reads:
--
--     check (status in ('submitted', 'approved', 'rejected'))
--
-- so that update raises 23514 every time, and delivery of anything not yet
-- approved fails outright. An APPROVED submission delivers fine — the case
-- expression leaves its status alone — which is why this has gone unnoticed:
-- the common path works and only the path 0115 was written to enable is
-- broken.
--
-- Two later migrations read the status the same way 0115 wrote it —
-- 0115 itself and 0126 both filter `status in ('submitted','approved','sent')`
-- — so every part of this feature except the constraint already believes
-- 'sent' is a real status. It is the constraint that is out of date.
--
-- Found by unpinning tenancy.test.ts from migration 0096: the delivery test
-- had been asserting 0010's rule ("must be approved") against a schema that
-- stopped at 0096, so it never met 0115.

alter table team_work_submissions drop constraint if exists team_work_submissions_status_check;
alter table team_work_submissions add constraint team_work_submissions_status_check
  check (status in ('submitted', 'approved', 'rejected', 'sent'));
