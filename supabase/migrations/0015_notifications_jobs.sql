-- Phase 13: notifications, reminders, cron jobs. Notifications de-dupe on a
-- unique key so generators are idempotent on re-run. cron_runs records every
-- job execution (queryable). Generators support dry_run.

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  recipient_uid uuid not null references auth.users (id) on delete cascade,
  type          text not null default 'general',
  title         text not null,
  body          text,
  entity_type   text,
  entity_id     uuid,
  dedupe_key    text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (company_id, recipient_uid, dedupe_key)
);
create index notifications_recipient_idx on notifications (company_id, recipient_uid, read_at);

create table notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications (id) on delete cascade,
  channel         text not null default 'in_app',
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'provider_missing')),
  created_at      timestamptz not null default now()
);

create table reminders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  user_id     uuid not null references users (user_id) on delete cascade,
  entity_type text,
  entity_id   uuid,
  title       text not null,
  remind_at   timestamptz not null,
  priority    text not null default 'medium',
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index reminders_due_idx on reminders (company_id, remind_at) where not done;

-- Every cron execution is recorded here (idempotency + observability).
create table cron_runs (
  id          uuid primary key default gen_random_uuid(),
  job_name    text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  dry_run     boolean not null default false,
  summary     jsonb not null default '{}'::jsonb
);
create index cron_runs_job_idx on cron_runs (job_name, started_at desc);

alter table notifications          enable row level security;
alter table notification_deliveries enable row level security;
alter table reminders              enable row level security;
alter table cron_runs              enable row level security;

-- Users see their own notifications; reminders scoped to owner/creator+company.
create policy notifications_own on notifications
  for select to authenticated
  using (company_id = get_current_company_id() and recipient_uid = auth.uid());
create policy notifications_mark on notifications
  for update to authenticated
  using (company_id = get_current_company_id() and recipient_uid = auth.uid())
  with check (company_id = get_current_company_id() and recipient_uid = auth.uid());

create policy reminders_select on reminders
  for select to authenticated
  using (company_id = get_current_company_id()
         and (is_current_admin_or_manager() or user_id = auth.uid()));
create policy reminders_write on reminders
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- cron_runs: readable by owner (observability), written only by definer fns.
create policy cron_runs_select_owner on cron_runs
  for select to authenticated
  using (is_current_owner());

-- ── Idempotent notification creation ──────────────────────────
create or replace function create_notification(
  p_company_id uuid,
  p_recipient  uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_dedupe_key text,
  p_entity_type text default null,
  p_entity_id  uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows int;
begin
  insert into notifications (company_id, recipient_uid, type, title, body, dedupe_key, entity_type, entity_id)
    values (p_company_id, p_recipient, p_type, p_title, p_body, p_dedupe_key, p_entity_type, p_entity_id)
  on conflict (company_id, recipient_uid, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ── Reminder cron generator (idempotent, dry_run-aware) ───────
-- Turns due reminders into notifications. Re-running creates nothing new
-- because notifications de-dupe on 'reminder:<id>'.
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
    select * from reminders where not done and remind_at <= now()
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

revoke all on function create_notification(uuid, uuid, text, text, text, text, text, uuid) from public, anon;
revoke all on function run_reminder_cron(boolean) from public, anon;
grant execute on function run_reminder_cron(boolean) to service_role;
