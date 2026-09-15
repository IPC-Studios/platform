-- PEOPLE parity: work submission extended fields (Lovable Submit form).
-- Additive only: new nullable columns + wider RPC signatures with defaults
-- so old 4/5-arg calls keep working.

alter table team_work_submissions add column if not exists title text;
alter table team_work_submissions add column if not exists work_type text;
alter table team_work_submissions add column if not exists method text;
alter table team_work_submissions add column if not exists storage_ref text;
alter table team_work_submissions add column if not exists hard_disk_label text;
alter table team_work_submissions add column if not exists review_required boolean not null default true;
alter table team_work_submissions add column if not exists review_state text;
alter table team_work_submissions add column if not exists version int not null default 1;
alter table team_work_submissions add column if not exists client_sent_at timestamptz;
alter table team_work_submissions add column if not exists client_channel text;

-- submit_work: accept the new fields (all optional, defaulted). Drop the
-- previous 5-arg version first: a 5-arg named call would otherwise match
-- both signatures and Postgres refuses the call as ambiguous.
drop function if exists submit_work(uuid, uuid, text, text, text);

create or replace function submit_work(
  p_task_id        uuid,
  p_project_id     uuid,
  p_link           text,
  p_notes          text default null,
  p_location_note  text default null,
  p_title          text default null,
  p_work_type      text default null,
  p_method         text default null,
  p_storage_ref    text default null,
  p_hard_disk_label text default null,
  p_folder_path    text default null,
  p_disk_name      text default null,
  p_disk_location  text default null,
  p_review_required boolean default true
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
  insert into team_work_submissions (
    company_id, task_id, project_id, submitted_by, submission_link, notes,
    location_note, title, work_type, method, storage_ref, hard_disk_label,
    folder_path, disk_name, disk_location, review_required
  ) values (
    get_current_company_id(), p_task_id, p_project_id, auth.uid(), p_link, p_notes,
    p_location_note, nullif(trim(coalesce(p_title, '')), ''), p_work_type, p_method,
    p_storage_ref, coalesce(p_hard_disk_label, p_disk_name), p_folder_path,
    p_disk_name, p_disk_location, coalesce(p_review_required, true)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function submit_work(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function submit_work(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, boolean) to authenticated;

-- update_work_submission: same new fields + resubmit flow. A rejected
-- submission can be edited by its submitter (or admin/manager): the edit
-- bumps the version and reopens it as submitted. Anything already
-- approved stays immutable.
drop function if exists update_work_submission(uuid, text, text, text);

create or replace function update_work_submission(
  p_submission_id  uuid,
  p_link           text,
  p_notes          text default null,
  p_location_note  text default null,
  p_title          text default null,
  p_work_type      text default null,
  p_method         text default null,
  p_storage_ref    text default null,
  p_hard_disk_label text default null,
  p_folder_path    text default null,
  p_disk_name      text default null,
  p_disk_location  text default null,
  p_review_required boolean default null
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
  if v_status = 'approved' then
    raise exception 'a reviewed submission cannot be edited' using errcode = '23514';
  end if;

  update team_work_submissions set
    submission_link = p_link,
    notes = p_notes,
    location_note = p_location_note,
    title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
    work_type = coalesce(p_work_type, work_type),
    method = coalesce(p_method, method),
    storage_ref = coalesce(p_storage_ref, storage_ref),
    hard_disk_label = coalesce(p_hard_disk_label, p_disk_name, hard_disk_label),
    folder_path = coalesce(p_folder_path, folder_path),
    disk_name = coalesce(p_disk_name, disk_name),
    disk_location = coalesce(p_disk_location, disk_location),
    review_required = coalesce(p_review_required, review_required),
    -- Resubmit: a rejected edit reopens the row and records a new version.
    status = case when v_status = 'rejected' then 'submitted' else status end,
    version = case when v_status = 'rejected' then version + 1 else version end,
    review_state = case when v_status = 'rejected' then null else review_state end
  where id = p_submission_id;
end;
$$;

revoke all on function update_work_submission(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function update_work_submission(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean) to authenticated;

-- Client-send stamp: which channel a submission went out on (email/whatsapp/log).
create or replace function mark_work_client_sent(
  p_submission_id uuid,
  p_channel       text default 'email'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update team_work_submissions set
    client_sent_at = now(),
    client_channel = p_channel,
    review_state = 'sent'
  where id = p_submission_id and company_id = get_current_company_id();
  if not found then
    raise exception 'submission not in this studio' using errcode = '42501';
  end if;
end;
$$;

revoke all on function mark_work_client_sent(uuid, text) from public, anon;
grant execute on function mark_work_client_sent(uuid, text) to authenticated;
