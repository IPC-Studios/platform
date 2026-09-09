-- Lovable parity: the old app let an admin turn work-submission reminders
-- on/off and choose which day-thresholds before a task's due date trigger
-- one. No equivalent existed -- not the setting, not the sweep.
--
-- The old model keyed off a deliverable's due date; team_work_submissions
-- links to a task (or a project) rather than a deliverable directly, so this
-- keys off tasks.due_date instead -- the same idea, following the column
-- that actually connects the two tables today.
create table if not exists work_submission_reminder_settings (
  company_id    uuid primary key references companies (id) on delete cascade,
  enabled       boolean not null default true,
  reminder_days int[]   not null default '{7,3,1}',
  updated_at    timestamptz not null default now()
);
drop trigger if exists wsrs_set_updated_at on work_submission_reminder_settings;
create trigger wsrs_set_updated_at before update on work_submission_reminder_settings
  for each row execute function set_updated_at();

alter table work_submission_reminder_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'wsrs_select') then
    create policy wsrs_select on work_submission_reminder_settings
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'wsrs_write') then
    create policy wsrs_write on work_submission_reminder_settings
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_owner())
      with check (company_id = get_current_company_id() and is_current_owner());
  end if;
end $$;

create or replace function get_work_submission_reminder_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('enabled', enabled, 'reminder_days', reminder_days)
       from work_submission_reminder_settings where company_id = get_current_company_id()),
    jsonb_build_object('enabled', true, 'reminder_days', array[7, 3, 1])
  )
$$;

revoke all on function get_work_submission_reminder_settings() from public, anon;
grant execute on function get_work_submission_reminder_settings() to authenticated;

create or replace function set_work_submission_reminder_settings(p_enabled boolean, p_reminder_days int[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into work_submission_reminder_settings (company_id, enabled, reminder_days)
    values (get_current_company_id(), p_enabled, p_reminder_days)
  on conflict (company_id) do update set enabled = excluded.enabled, reminder_days = excluded.reminder_days;
end;
$$;

revoke all on function set_work_submission_reminder_settings(boolean, int[]) from public, anon;
grant execute on function set_work_submission_reminder_settings(boolean, int[]) to authenticated;

-- One notification per task per day, so a threshold hit once does not repeat
-- on every hourly tick until the due date passes.
create or replace function run_work_submission_reminder_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due     int := 0;
  v_created int := 0;
  v_r       record;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('work_submission_reminder_cron', p_dry_run) returning id into v_run;

  for v_r in
    select t.id as task_id, t.company_id, t.title, a.user_id
      from tasks t
      join task_assignees a on a.task_id = t.id
      join work_submission_reminder_settings s on s.company_id = t.company_id and s.enabled
     where t.due_date is not null
       and t.status not in ('completed', 'cancelled')
       and (t.due_date - current_date) = any (s.reminder_days)
       and not exists (
         select 1 from team_work_submissions w
          where w.task_id = t.id and w.status <> 'rejected'
       )
  loop
    v_due := v_due + 1;
    if not p_dry_run then
      if create_notification(v_r.company_id, v_r.user_id, 'work_reminder',
           v_r.title || ' is due soon — submit your work', null,
           'work_reminder:' || v_r.task_id || ':' || current_date, 'task', v_r.task_id) then
        v_created := v_created + 1;
      end if;
    end if;
  end loop;

  v_summary := jsonb_build_object('tasks_due', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

revoke all on function run_work_submission_reminder_cron(boolean) from public, anon;
grant execute on function run_work_submission_reminder_cron(boolean) to service_role;
