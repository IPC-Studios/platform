-- Submitting work has never been possible.
--
-- team_work_submissions was designed to be written only through SECURITY
-- DEFINER functions — submit_work(), review_work(), deliver_work_to_client()
-- — so 0010 gave it a SELECT policy and no write policy at all, which is
-- correct for that design.
--
-- POST /work/submissions later stopped calling submit_work() and began
-- inserting directly, because the RPC predates the hard-disk/folder handover
-- columns and was dropping them. A direct insert runs as the authenticated
-- role under RLS, and with no INSERT policy Postgres refuses it: 42501, which
-- attempt() turns into "You do not have access to this action."
--
-- So every submission 403'd, for every user including the owner. Nothing ever
-- reached review, and nothing could be delivered to a client — the whole
-- submit → review → deliver chain was dead at the first step, with a
-- permissions message that reads like a deliberate restriction.
--
-- The policy mirrors what submit_work() enforced: you insert into your own
-- studio, as yourself. Review and delivery still go through their definer
-- functions, so this does not widen those.

drop policy if exists tws_insert on team_work_submissions;
create policy tws_insert on team_work_submissions
  for insert to authenticated
  with check (
    company_id = get_current_company_id()
    and submitted_by = auth.uid()
    and is_current_user_active()
  );

-- The edit path (update_work_submission) is a definer function and already
-- checks submitter-or-manager plus "not yet reviewed", so it needs no policy.
-- Nothing here grants UPDATE or DELETE: a submission is the record of what was
-- judged, and it stays that way.
