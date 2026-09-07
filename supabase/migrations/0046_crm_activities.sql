-- 0046: CRM activities — calls, emails, meetings, notes, tasks and messages
-- as first-class rows, and the integrations a studio has connected.
--
-- crm_lead_events (0032) is the stage/audit trail: what the system saw. An
-- activity is what a person did — a call that lasted eleven minutes, a
-- meeting on Thursday, a task to send the album mock-up. The timeline in
-- the drawer merges both. Additive: nothing here changes an existing table.

create table if not exists crm_activities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  lead_id     uuid references crm_leads (id) on delete cascade,
  contact_id  uuid references crm_contacts (id) on delete set null,
  type        text not null check (type in ('call', 'email', 'meeting', 'note', 'task', 'whatsapp', 'sms')),
  -- in = they reached us, out = we reached them, none = a note or a task.
  direction   text not null default 'none' check (direction in ('in', 'out', 'none')),
  subject     text check (subject is null or char_length(subject) <= 200),
  body        text check (body is null or char_length(body) <= 8000),
  -- For calls: answered | no_answer | busy | voicemail | wrong_number; free text otherwise.
  outcome     text check (outcome is null or char_length(outcome) <= 60),
  started_at  timestamptz,
  ended_at    timestamptz,
  duration_s  int check (duration_s is null or duration_s between 0 and 86400),
  -- Tasks: when it is owed and when it was done.
  due_at      timestamptz,
  done_at     timestamptz,
  assigned_to uuid references users (user_id) on delete set null,
  actor_id    uuid references auth.users (id) on delete set null,
  provider    text not null default 'manual' check (provider in ('manual', 'twilio', 'gmail', 'o365', 'whatsapp')),
  -- The provider's own id (a Gmail message id, a Twilio call SID): the dedupe key for syncs.
  external_id text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index if not exists crm_activities_lead_idx on crm_activities (company_id, lead_id, created_at desc);
create index if not exists crm_activities_contact_idx on crm_activities (contact_id, created_at desc) where contact_id is not null;
create index if not exists crm_activities_feed_idx on crm_activities (company_id, created_at desc);
create index if not exists crm_activities_due_idx on crm_activities (company_id, due_at) where type = 'task' and done_at is null;
create unique index if not exists crm_activities_external_idx on crm_activities (company_id, provider, external_id) where external_id is not null;
drop trigger if exists crm_activities_set_updated_at on crm_activities;
create trigger crm_activities_set_updated_at before update on crm_activities
  for each row execute function set_updated_at();

-- What a studio has connected. Credentials live in the deployment's env; this
-- row says whether the studio has switched the integration on, and carries
-- the non-secret settings (a mailbox, a caller id).
create table if not exists crm_integrations (
  company_id   uuid not null references companies (id) on delete cascade,
  provider     text not null check (provider in ('gmail', 'o365', 'twilio')),
  status       text not null default 'not_configured' check (status in ('not_configured', 'connected', 'error')),
  config       jsonb not null default '{}'::jsonb,
  last_error   text,
  last_sync_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (company_id, provider)
);
drop trigger if exists crm_integrations_set_updated_at on crm_integrations;
create trigger crm_integrations_set_updated_at before update on crm_integrations
  for each row execute function set_updated_at();

alter table crm_activities   enable row level security;
alter table crm_integrations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_activities_select') then
    create policy crm_activities_select on crm_activities
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_activities_write') then
    create policy crm_activities_write on crm_activities
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_integrations_select') then
    create policy crm_integrations_select on crm_integrations
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_integrations_write') then
    create policy crm_integrations_write on crm_integrations
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_owner())
      with check (company_id = get_current_company_id() and is_current_owner());
  end if;
end $$;

-- ── what an activity does to the deal it is on ────────────────
-- Reaching out stamps the first contact. A reply from the lead is the moment
-- a cadence has done its job: it stops, and the deal is marked engaged.
create or replace function crm_activities_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stopped text;
begin
  if new.lead_id is null then return null; end if;

  if new.type in ('call', 'email', 'meeting', 'whatsapp', 'sms') then
    if new.direction = 'out' then
      update crm_leads set last_contacted_at = coalesce(last_contacted_at, coalesce(new.started_at, new.created_at))
       where id = new.lead_id;
    elsif new.direction = 'in' then
      update crm_leads set last_contacted_at = coalesce(last_contacted_at, coalesce(new.started_at, new.created_at))
       where id = new.lead_id;
      update crm_lead_cadences lc
         set stopped_at = now()
       where lc.lead_id = new.lead_id and lc.stopped_at is null and lc.completed_at is null
      returning (select name from crm_cadences where id = lc.cadence_id) into v_stopped;
      if v_stopped is not null then
        insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
        values (new.company_id, new.lead_id, null, null, null, 'replied via ' || new.type || ' · cadence stopped: ' || v_stopped);
      end if;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists crm_activities_after_insert on crm_activities;
create trigger crm_activities_after_insert after insert on crm_activities
  for each row execute function crm_activities_after_insert();

create or replace function crm_activities_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.actor_id is null then new.actor_id := auth.uid(); end if;
  if new.contact_id is null and new.lead_id is not null then
    select contact_id into new.contact_id from crm_leads where id = new.lead_id;
  end if;
  if new.type = 'task' and new.assigned_to is null then
    select assigned_to into new.assigned_to from crm_leads where id = new.lead_id;
  end if;
  if new.duration_s is null and new.started_at is not null and new.ended_at is not null then
    new.duration_s := least(86400, greatest(0, extract(epoch from (new.ended_at - new.started_at))::int));
  end if;
  return new;
end;
$$;
drop trigger if exists crm_activities_a_before_insert on crm_activities;
create trigger crm_activities_a_before_insert before insert on crm_activities
  for each row execute function crm_activities_before_insert();

-- ── tasks that are due, on the hourly tick ────────────────────
create or replace function crm_task_reminders(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_due int := 0;
  v_notified int := 0;
begin
  for v_r in
    select a.id, a.company_id, a.subject, a.due_at, coalesce(a.assigned_to, l.assigned_to) as who, l.name as lead_name, l.phone, a.lead_id
    from crm_activities a
    left join crm_leads l on l.id = a.lead_id
    where a.type = 'task' and a.done_at is null and a.due_at is not null and a.due_at <= now()
  loop
    v_due := v_due + 1;
    if p_dry_run or v_r.who is null then continue; end if;
    if create_notification(
         v_r.company_id, v_r.who, 'crm_task',
         'Task due: ' || coalesce(v_r.subject, 'follow up'),
         case when v_r.lead_name is not null or v_r.phone is not null then 'For ' || coalesce(v_r.lead_name, v_r.phone) else null end,
         'crm_task:' || v_r.id::text || ':' || current_date::text,
         'crm_lead', v_r.lead_id)
    then
      v_notified := v_notified + 1;
    end if;
  end loop;
  return jsonb_build_object('due', v_due, 'notified', v_notified);
end;
$$;
revoke all on function crm_task_reminders(boolean) from public, anon;
grant execute on function crm_task_reminders(boolean) to service_role;

create or replace function run_crm_followup_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_r record;
  v_overdue int := 0;
  v_notified int := 0;
  v_rules int := 0;
  v_cadences jsonb;
  v_sla jsonb;
  v_tasks jsonb;
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);
  v_sla := crm_sla_sweep(p_dry_run);
  v_tasks := crm_task_reminders(p_dry_run);

  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.follow_up_at
    from crm_leads l
    where l.is_archived = false
      and l.status not in ('converted', 'lost')
      and l.follow_up_at is not null
      and l.follow_up_at < now()
  loop
    v_overdue := v_overdue + 1;
    if p_dry_run then continue; end if;
    if v_r.assigned_to is not null then
      if create_notification(
           v_r.company_id, v_r.assigned_to, 'crm_overdue',
           'Follow-up overdue: ' || coalesce(v_r.name, v_r.phone, 'unnamed lead'),
           'Promised for ' || to_char(v_r.follow_up_at, 'DD Mon HH24:MI'),
           'crm_overdue:' || v_r.id::text || ':' || current_date::text,
           'crm_lead', v_r.id)
      then
        v_notified := v_notified + 1;
      end if;
    end if;
    v_rules := v_rules + crm_apply_automations(v_r.id, 'follow_up_overdue', null);
  end loop;

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified, 'rules_applied', v_rules,
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
