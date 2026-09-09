-- Lovable parity: the old submit-work form let someone say which physical
-- drive or folder something lives on, separately from a shareable link --
-- `location_note` has existed on team_work_submissions since 0010 and was
-- never read or written by anything.
-- A named-argument call with 4 args would otherwise match both this
-- signature and the old one (its 5th parameter has a default), which
-- Postgres refuses as ambiguous -- the same class of bug 0057 shipped with
-- issue_quote_link earlier this session. Drop the old one outright.
drop function if exists submit_work(uuid, uuid, text, text);

create or replace function submit_work(
  p_task_id       uuid,
  p_project_id    uuid,
  p_link          text,
  p_notes         text default null,
  p_location_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into team_work_submissions (company_id, task_id, project_id, submitted_by, submission_link, notes, location_note)
    values (get_current_company_id(), p_task_id, p_project_id, auth.uid(), p_link, p_notes, p_location_note)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function submit_work(uuid, uuid, text, text, text) from public, anon;
grant execute on function submit_work(uuid, uuid, text, text, text) to authenticated;
