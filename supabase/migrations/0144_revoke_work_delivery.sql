-- Revoking a client delivery never marked the submission.
--
-- The route ran three statements: expire the token, stamp `revoked_at` on the
-- submission, stamp it on the delivery row. The first is a SECURITY DEFINER
-- call and worked, so the client's link did stop opening. The second matched
-- no row, every time, and said nothing.
--
-- tws_update (0139) is scoped to `status = 'submitted'` — it was written for
-- editing a submission before review. But work is only ever SENT to a client
-- once it is approved, so every revocable row fails that predicate. RLS
-- filters an UPDATE rather than refusing it, so the statement reported
-- success having changed nothing, and the route returned `true` regardless.
-- The app could therefore never show that a link had been revoked.
--
-- Widening tws_update is the wrong fix: it would let anyone edit an approved
-- submission, and an RLS policy cannot be narrowed to one column. This table
-- was designed in 0010 to be written through definer functions; revoking
-- goes back to that, doing all three writes together behind one permission
-- check, and reporting whether it actually found the row.

create or replace function revoke_work_delivery(p_submission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_found   boolean;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- The same people who can deliver it: 0139 made revoking an admin/manager
  -- action on the delivery row, and this keeps the two in step.
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update team_work_submissions
     set revoked_at = now()
   where id = p_submission_id and company_id = v_company
  returning true into v_found;

  if not coalesce(v_found, false) then
    return false;
  end if;

  update team_work_client_deliveries
     set revoked_at = now()
   where submission_id = p_submission_id and company_id = v_company
     and revoked_at is null;

  -- Expiring the token is what actually closes the client's link; the stamps
  -- above are how the studio can see that it happened.
  perform revoke_access_token('work_delivery', p_submission_id);
  return true;
end;
$$;

revoke all on function revoke_work_delivery(uuid) from public, anon;
grant execute on function revoke_work_delivery(uuid) to authenticated;
