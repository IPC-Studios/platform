-- Reminders system: entity linking, priority and status.
--
-- `reminders` already exists from 0015 with (remind_at, done) and its own
-- policies, so this migrates that shape forward instead of creating a table.
-- A `create table if not exists` here silently did nothing on any database
-- that had run 0015 -- which is all of them -- and every statement after it
-- referred to columns that were never added.
alter table reminders
  add column if not exists description text,
  add column if not exists status      text not null default 'active',
  add column if not exists due_at      timestamptz,
  add column if not exists updated_at  timestamptz not null default now();

-- Carry the 0015 columns across, then retire them so there is one shape.
-- Guarded so the file re-applies cleanly.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reminders' and column_name = 'remind_at'
  ) then
    update reminders set due_at = coalesce(due_at, remind_at);
    update reminders set status = case when done then 'completed' else 'active' end;
    -- Drops reminders_due_idx with it: that index is partial on `done`.
    alter table reminders drop column remind_at, drop column done;
  end if;
end $$;

-- NOT VALID: new rows are constrained, rows written before this file are left
-- alone rather than failing the migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reminders_status_check') then
    alter table reminders add constraint reminders_status_check
      check (status in ('active', 'completed', 'dismissed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reminders_priority_check') then
    alter table reminders add constraint reminders_priority_check
      check (priority in ('low', 'medium', 'high', 'urgent')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reminders_entity_type_check') then
    alter table reminders add constraint reminders_entity_type_check
      check (entity_type is null or entity_type in ('lead', 'project', 'client', 'invoice', 'custom')) not valid;
  end if;
end $$;

create index if not exists reminders_company_user_idx on reminders (company_id, user_id, status, due_at);
create index if not exists reminders_due_idx on reminders (company_id, due_at) where status = 'active';
drop trigger if exists reminders_set_updated_at on reminders;
create trigger reminders_set_updated_at before update on reminders
  for each row execute function set_updated_at();

alter table reminders enable row level security;
-- 0015 created policies under these names; replace them rather than collide.
drop policy if exists reminders_select on reminders;
drop policy if exists reminders_write on reminders;
create policy reminders_select on reminders for select to authenticated
  using (company_id = get_current_company_id());
create policy reminders_write on reminders for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- The 0015 sweep read `not done and remind_at <= now()`; both columns are gone.
create or replace function run_reminder_cron(p_dry_run boolean default false)
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
  insert into cron_runs (job_name, dry_run) values ('reminder_cron', p_dry_run) returning id into v_run;

  for v_r in
    select * from reminders where status = 'active' and due_at is not null and due_at <= now()
  loop
    v_due := v_due + 1;
    if not p_dry_run then
      if create_notification(v_r.company_id, v_r.user_id, 'reminder', v_r.title, null,
           'reminder:' || v_r.id, v_r.entity_type, v_r.entity_id) then
        v_created := v_created + 1;
      end if;
    end if;
  end loop;

  v_summary := jsonb_build_object('reminders_due', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_reminder_cron(boolean) from public, anon;
grant execute on function run_reminder_cron(boolean) to service_role;

-- RPC: list reminders with summary
create or replace function list_reminders(
  p_status   text default null,
  p_priority text default null,
  p_user_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_user    uuid := auth.uid();
  v_items   jsonb;
  v_summary jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(r)) into v_items
  from (
    select id, company_id, user_id, title, description, priority, status,
           entity_type, entity_id, due_at, created_at
      from reminders
     where company_id = v_company
       and (p_status is null or status = p_status)
       and (p_priority is null or priority = p_priority)
       and (p_user_id is null or user_id = p_user_id)
     order by
       case priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
       due_at nulls last,
       created_at desc
  ) r;

  select jsonb_build_object(
    'total_count', count(*)::int,
    'active_count', count(*) filter (where status = 'active')::int,
    'overdue_count', count(*) filter (where status = 'active' and due_at < now())::int,
    'due_today_count', count(*) filter (where status = 'active' and due_at::date = current_date)::int
  ) into v_summary
  from reminders
  where company_id = v_company and (p_user_id is null or user_id = p_user_id);

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary
  );
end;
$$;

revoke all on function list_reminders(text, text, uuid) from public, anon;
grant execute on function list_reminders(text, text, uuid) to authenticated;
