-- team_work_submissions has no write RLS policy -- rows only ever change
-- through submit_work()/review_work()/deliver_work_to_client() -- so a
-- typo'd link or note on a submission had no fix path before it was
-- reviewed, and the reviewer would be judging the wrong thing. Same
-- shape as review_work(): a SECURITY DEFINER function, restricted to the
-- person who submitted it (or an admin/manager) and to a submission still
-- awaiting review -- once reviewed, the record is what was actually judged.
create or replace function update_work_submission(
  p_submission_id uuid,
  p_link          text,
  p_notes         text default null,
  p_location_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submitter uuid;
  v_status    text;
begin
  select submitted_by, status into v_submitter, v_status
    from team_work_submissions
   where id = p_submission_id and company_id = get_current_company_id();

  if v_submitter is null then
    raise exception 'submission not in this studio' using errcode = '42501';
  end if;
  if not (is_current_admin_or_manager() or v_submitter = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'a reviewed submission cannot be edited' using errcode = '23514';
  end if;

  update team_work_submissions set
    submission_link = p_link,
    notes = p_notes,
    location_note = p_location_note
  where id = p_submission_id;
end;
$$;
revoke all on function update_work_submission(uuid, text, text, text) from public, anon;
grant execute on function update_work_submission(uuid, text, text, text) to authenticated;
