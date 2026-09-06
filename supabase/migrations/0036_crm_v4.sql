-- 0036: CRM v4 — saved views that follow the person, an SLA target, follow-up
-- cadences, lead → project conversion, and the team view measuring against
-- the SLA. Additive; one function (crm_team_stats) changes its return type
-- and is dropped and recreated.

-- ══════════════════════════════════════════════════════════════
-- Saved views: a person's own filters, on every device
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_saved_views (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  query      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists crm_saved_views_user_idx on crm_saved_views (company_id, user_id);
drop trigger if exists crm_saved_views_set_updated_at on crm_saved_views;
create trigger crm_saved_views_set_updated_at before update on crm_saved_views
  for each row execute function set_updated_at();

alter table crm_saved_views enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_saved_views_own') then
    create policy crm_saved_views_own on crm_saved_views
      for all to authenticated
      using (company_id = get_current_company_id() and user_id = auth.uid())
      with check (company_id = get_current_company_id() and user_id = auth.uid() and is_current_user_active());
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════
-- CRM settings: the SLA target
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_settings (
  company_id uuid primary key references companies (id) on delete cascade,
  -- Hours a new lead may wait before first contact and still count as on time.
  sla_hours  int not null default 24 check (sla_hours between 1 and 720),
  updated_at timestamptz not null default now()
);
drop trigger if exists crm_settings_set_updated_at on crm_settings;
create trigger crm_settings_set_updated_at before update on crm_settings
  for each row execute function set_updated_at();

alter table crm_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_settings_select') then
    create policy crm_settings_select on crm_settings
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_settings_write') then
    create policy crm_settings_write on crm_settings
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_owner())
      with check (company_id = get_current_company_id() and is_current_owner());
  end if;
end $$;

create or replace function crm_sla_hours()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.sla_hours from crm_settings s where s.company_id = get_current_company_id()), 24)
$$;
revoke all on function crm_sla_hours() from public, anon;
grant execute on function crm_sla_hours() to authenticated;

-- ══════════════════════════════════════════════════════════════
-- Cadences: a follow-up sequence a lead is put on
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_cadences (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists crm_cadences_set_updated_at on crm_cadences;
create trigger crm_cadences_set_updated_at before update on crm_cadences
  for each row execute function set_updated_at();

create table if not exists crm_cadence_steps (
  id          uuid primary key default gen_random_uuid(),
  cadence_id  uuid not null references crm_cadences (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  step_no     int not null check (step_no between 1 and 30),
  -- Days after the cadence starts. Step 1 at 0 = the same day.
  day_offset  int not null check (day_offset between 0 and 365),
  template_id uuid references crm_templates (id) on delete set null,
  note        text,
  unique (cadence_id, step_no)
);

create table if not exists crm_lead_cadences (
  lead_id      uuid primary key references crm_leads (id) on delete cascade,
  company_id   uuid not null references companies (id) on delete cascade,
  cadence_id   uuid not null references crm_cadences (id) on delete cascade,
  step_no      int not null default 1,
  next_at      timestamptz,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  stopped_at   timestamptz
);
create index if not exists crm_lead_cadences_due_idx on crm_lead_cadences (next_at)
  where completed_at is null and stopped_at is null;

alter table crm_cadences       enable row level security;
alter table crm_cadence_steps  enable row level security;
alter table crm_lead_cadences  enable row level security;
do $$
declare t text;
begin
  foreach t in array array['crm_cadences', 'crm_cadence_steps', 'crm_lead_cadences'] loop
    if not exists (select 1 from pg_policies where policyname = t || '_select') then
      execute format('create policy %I_select on %I for select to authenticated using (company_id = get_current_company_id());', t, t);
    end if;
    if not exists (select 1 from pg_policies where policyname = t || '_write') then
      execute format('create policy %I_write on %I for all to authenticated
        using (company_id = get_current_company_id() and is_current_user_active())
        with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
    end if;
  end loop;
end $$;

-- A step lands at 10:00 on its day, counted from the day the cadence began.
create or replace function crm_cadence_step_time(p_started timestamptz, p_day_offset int)
returns timestamptz
language sql
immutable
as $$
  select date_trunc('day', p_started) + make_interval(days => p_day_offset) + interval '10 hours'
$$;

create or replace function start_lead_cadence(p_lead uuid, p_cadence uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_cadence crm_cadences;
  v_step    crm_cadence_steps;
  v_next    timestamptz;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_cadence from crm_cadences where id = p_cadence and company_id = v_company and is_active;
  if not found then
    raise exception 'unknown cadence' using errcode = '42501';
  end if;
  if not exists (select 1 from crm_leads where id = p_lead and company_id = v_company) then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  select * into v_step from crm_cadence_steps where cadence_id = p_cadence order by step_no limit 1;
  if not found then
    raise exception 'cadence has no steps' using errcode = '22023';
  end if;

  v_next := greatest(crm_cadence_step_time(now(), v_step.day_offset), now() + interval '5 minutes');
  insert into crm_lead_cadences (lead_id, company_id, cadence_id, step_no, next_at)
  values (p_lead, v_company, p_cadence, v_step.step_no, v_next)
  on conflict (lead_id) do update
    set cadence_id = excluded.cadence_id, step_no = excluded.step_no, next_at = excluded.next_at,
        started_at = now(), completed_at = null, stopped_at = null;

  update crm_leads set follow_up_at = v_next where id = p_lead;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(), 'cadence started: ' || v_cadence.name);
  return v_next;
end;
$$;
revoke all on function start_lead_cadence(uuid, uuid) from public, anon;
grant execute on function start_lead_cadence(uuid, uuid) to authenticated;

create or replace function stop_lead_cadence(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_name text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update crm_lead_cadences lc
     set stopped_at = now()
   where lc.lead_id = p_lead and lc.company_id = v_company and lc.stopped_at is null and lc.completed_at is null
  returning (select name from crm_cadences where id = lc.cadence_id) into v_name;
  if not found then return false; end if;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(), 'cadence stopped: ' || coalesce(v_name, ''));
  return true;
end;
$$;
revoke all on function stop_lead_cadence(uuid) from public, anon;
grant execute on function stop_lead_cadence(uuid) to authenticated;

-- A closed lead owes nobody a call: winning or losing ends the cadence.
create or replace function crm_leads_stop_cadence_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('converted', 'lost') and old.status not in ('converted', 'lost') then
    update crm_lead_cadences set stopped_at = now()
     where lead_id = new.id and stopped_at is null and completed_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists crm_leads_stop_cadence on crm_leads;
create trigger crm_leads_stop_cadence after update of status on crm_leads
  for each row execute function crm_leads_stop_cadence_trigger();

-- The hourly sweep: every due step becomes a follow-up + a notification, and
-- the lead moves to the next step (or completes).
create or replace function crm_advance_cadences(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_next crm_cadence_steps;
  v_due int := 0;
  v_advanced int := 0;
  v_completed int := 0;
  v_next_at timestamptz;
  v_body text;
begin
  for v_r in
    select lc.lead_id, lc.company_id, lc.cadence_id, lc.step_no, lc.started_at,
           c.name as cadence_name, s.note, s.template_id, t.name as template_name,
           l.assigned_to, l.name as lead_name, l.phone
    from crm_lead_cadences lc
    join crm_cadences c on c.id = lc.cadence_id
    join crm_cadence_steps s on s.cadence_id = lc.cadence_id and s.step_no = lc.step_no
    join crm_leads l on l.id = lc.lead_id
    left join crm_templates t on t.id = s.template_id
    where lc.completed_at is null and lc.stopped_at is null and lc.next_at <= now()
      and l.is_archived = false and l.status not in ('converted', 'lost')
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;

    v_body := coalesce(v_r.note, '') || case when v_r.template_name is not null then ' · send "' || v_r.template_name || '"' else '' end;
    if v_r.assigned_to is not null then
      perform create_notification(
        v_r.company_id, v_r.assigned_to, 'crm_cadence',
        v_r.cadence_name || ' step ' || v_r.step_no || ': ' || coalesce(v_r.lead_name, v_r.phone, 'lead'),
        nullif(trim(v_body), ''),
        'cadence:' || v_r.lead_id::text || ':' || v_r.step_no::text,
        'crm_lead', v_r.lead_id);
    end if;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_r.company_id, v_r.lead_id, null, null, null,
            'cadence step ' || v_r.step_no || ' due' || case when v_r.note is not null then ': ' || v_r.note else '' end);

    select * into v_next from crm_cadence_steps
     where cadence_id = v_r.cadence_id and step_no > v_r.step_no order by step_no limit 1;
    if found then
      v_next_at := greatest(crm_cadence_step_time(v_r.started_at, v_next.day_offset), now() + interval '1 hour');
      update crm_lead_cadences set step_no = v_next.step_no, next_at = v_next_at where lead_id = v_r.lead_id;
      update crm_leads set follow_up_at = v_next_at where id = v_r.lead_id;
      v_advanced := v_advanced + 1;
    else
      update crm_lead_cadences set completed_at = now(), next_at = null where lead_id = v_r.lead_id;
      v_completed := v_completed + 1;
    end if;
  end loop;
  return jsonb_build_object('due', v_due, 'advanced', v_advanced, 'completed', v_completed);
end;
$$;
revoke all on function crm_advance_cadences(boolean) from public, anon;
grant execute on function crm_advance_cadences(boolean) to service_role;

-- Fold the cadence sweep into the hourly follow-up job.
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
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);

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
                                  'cadences', v_cadences, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

-- Automations can put a lead on a cadence.
alter table crm_automation_rules drop constraint if exists crm_automation_rules_action_check;
alter table crm_automation_rules add constraint crm_automation_rules_action_check
  check (action in ('assign_to', 'set_follow_up_days', 'mark_hot', 'add_note', 'notify_assignee', 'start_cadence'));

create or replace function crm_apply_automations(p_lead_id uuid, p_trigger text, p_from_status text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead crm_leads;
  v_rule crm_automation_rules;
  v_applied int := 0;
  v_title text;
  v_cadence uuid;
  v_step crm_cadence_steps;
  v_next timestamptz;
begin
  select * into v_lead from crm_leads where id = p_lead_id;
  if not found then return 0; end if;

  for v_rule in
    select * from crm_automation_rules
    where company_id = v_lead.company_id and is_active and trigger = p_trigger
    order by created_at
  loop
    if not crm_rule_matches(v_rule.condition, v_lead, p_from_status) then continue; end if;

    if p_trigger = 'follow_up_overdue' then
      insert into crm_automation_runs (rule_id, lead_id) values (v_rule.id, v_lead.id)
      on conflict do nothing;
      if not found then continue; end if;
    end if;

    if v_rule.action = 'assign_to' then
      update crm_leads set assigned_to = nullif(v_rule.action_value->>'user_id', '')::uuid where id = v_lead.id;
    elsif v_rule.action = 'set_follow_up_days' then
      update crm_leads
         set follow_up_at = date_trunc('day', now()) + make_interval(days => coalesce((v_rule.action_value->>'days')::int, 1)) + interval '10 hours'
       where id = v_lead.id;
    elsif v_rule.action = 'mark_hot' then
      update crm_leads set is_hot = true where id = v_lead.id;
    elsif v_rule.action = 'add_note' then
      update crm_leads
         set notes = nullif(trim(coalesce(notes, '') || chr(10) || coalesce(v_rule.action_value->>'note', '')), '')
       where id = v_lead.id;
    elsif v_rule.action = 'notify_assignee' then
      if v_lead.assigned_to is not null then
        v_title := case p_trigger
          when 'lead_created' then 'New lead: ' || coalesce(v_lead.name, v_lead.phone, 'unnamed')
          when 'stage_changed' then coalesce(v_lead.name, v_lead.phone, 'A lead') || ' moved to ' || v_lead.status
          else 'Follow-up overdue: ' || coalesce(v_lead.name, v_lead.phone, 'unnamed') end;
        perform create_notification(
          v_lead.company_id, v_lead.assigned_to, 'crm', v_title,
          coalesce(v_rule.action_value->>'note', null),
          'crm_auto:' || v_rule.id::text || ':' || v_lead.id::text || ':' || p_trigger || ':' || current_date::text,
          'crm_lead', v_lead.id);
      end if;
    elsif v_rule.action = 'start_cadence' then
      -- Same as start_lead_cadence, without the caller checks: this runs from
      -- a trigger or the cron, as the definer.
      v_cadence := nullif(v_rule.action_value->>'cadence_id', '')::uuid;
      select * into v_step from crm_cadence_steps s
        join crm_cadences c on c.id = s.cadence_id
       where s.cadence_id = v_cadence and c.company_id = v_lead.company_id and c.is_active
       order by s.step_no limit 1;
      if found then
        v_next := greatest(crm_cadence_step_time(now(), v_step.day_offset), now() + interval '5 minutes');
        insert into crm_lead_cadences (lead_id, company_id, cadence_id, step_no, next_at)
        values (v_lead.id, v_lead.company_id, v_cadence, v_step.step_no, v_next)
        on conflict (lead_id) do nothing;
        if found then
          update crm_leads set follow_up_at = v_next where id = v_lead.id;
        end if;
      end if;
    end if;

    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_lead.company_id, v_lead.id, null, null, null, 'automation: ' || v_rule.name);
    v_applied := v_applied + 1;
  end loop;
  return v_applied;
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- Lead → project: the moment a lead is won, the project exists
-- ══════════════════════════════════════════════════════════════
alter table crm_leads
  add column if not exists converted_project_id uuid references projects (id) on delete set null;

create or replace function convert_lead_to_project(
  p_lead      uuid,
  p_client_id uuid default null,
  p_client    jsonb default '{}'::jsonb,
  p_project   jsonb default '{}'::jsonb
)
returns table (client_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_lead    crm_leads;
  v_client  uuid := p_client_id;
  v_project uuid;
  v_name    text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_lead from crm_leads where id = p_lead and company_id = v_company;
  if not found then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  if v_lead.converted_project_id is not null then
    raise exception 'already converted' using errcode = '22023';
  end if;

  if v_client is null then
    insert into clients (company_id, name, email, phone, alternate_phone, address, city, notes, created_by)
    values (
      v_company,
      coalesce(nullif(p_client->>'name', ''), v_lead.name, v_lead.phone, 'New client'),
      coalesce(nullif(p_client->>'email', ''), v_lead.email),
      coalesce(nullif(p_client->>'phone', ''), v_lead.phone),
      nullif(p_client->>'alternate_phone', ''),
      nullif(p_client->>'address', ''),
      nullif(p_client->>'city', ''),
      nullif(p_client->>'notes', ''),
      auth.uid()
    )
    returning id into v_client;
  elsif not exists (select 1 from clients where id = v_client and company_id = v_company) then
    raise exception 'unknown client' using errcode = '42501';
  end if;

  v_name := coalesce(nullif(p_project->>'name', ''), coalesce(v_lead.name, 'New') || ' project');
  v_project := create_project_with_details(
    v_client,
    v_name,
    coalesce((p_project->>'package_cost')::numeric, 0),
    coalesce(nullif(p_project->>'status', ''), 'active'),
    false,
    '[]'::jsonb,
    '[]'::jsonb
  );

  -- The stage trigger stamps converted_at and the event; the project link is ours.
  update crm_leads set status = 'converted', converted_project_id = v_project where id = p_lead;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(), 'converted to project: ' || v_name);

  return query select v_client, v_project;
end;
$$;
revoke all on function convert_lead_to_project(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function convert_lead_to_project(uuid, uuid, jsonb, jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- Team view: measured against the SLA
-- ══════════════════════════════════════════════════════════════
drop function if exists crm_team_stats(date, date);
create or replace function crm_team_stats(p_from date, p_to date)
returns table (
  user_id uuid,
  user_name text,
  open int,
  overdue int,
  due_today int,
  uncontacted int,
  hot int,
  created int,
  won int,
  lost int,
  within_sla int,
  sla_hours int,
  avg_first_response_hours numeric
)
language sql
security definer
set search_path = public
as $$
  with members as (
    select u.user_id, u.name
    from users u
    where u.company_id = get_current_company_id() and u.deleted_at is null
  ),
  leads as (
    select l.* from crm_leads l
    where l.company_id = get_current_company_id() and l.is_archived = false
  ),
  sla as (select crm_sla_hours() as hours)
  select
    m.user_id,
    m.name,
    count(*) filter (where l.status not in ('converted','lost'))::int,
    count(*) filter (where l.status not in ('converted','lost') and l.follow_up_at is not null and l.follow_up_at < date_trunc('day', now()))::int,
    count(*) filter (where l.status not in ('converted','lost') and l.follow_up_at >= date_trunc('day', now()) and l.follow_up_at < date_trunc('day', now()) + interval '1 day')::int,
    count(*) filter (where l.status = 'new' and l.last_contacted_at is null)::int,
    count(*) filter (where l.is_hot and l.status not in ('converted','lost'))::int,
    count(*) filter (where l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz)::int,
    count(*) filter (where l.status = 'converted' and l.converted_at >= p_from::timestamptz and l.converted_at < (p_to + 1)::timestamptz)::int,
    count(*) filter (where l.status = 'lost' and l.stage_changed_at >= p_from::timestamptz and l.stage_changed_at < (p_to + 1)::timestamptz)::int,
    count(*) filter (where l.last_contacted_at is not null
                       and l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz
                       and l.last_contacted_at <= l.created_at + make_interval(hours => (select hours from sla)))::int,
    (select hours from sla),
    round((avg(extract(epoch from (l.last_contacted_at - l.created_at)))
             filter (where l.last_contacted_at is not null and l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz)
           / 3600)::numeric, 1)
  from members m
  left join leads l on l.assigned_to = m.user_id
  group by m.user_id, m.name
  order by m.name;
$$;
revoke all on function crm_team_stats(date, date) from public, anon;
grant execute on function crm_team_stats(date, date) to authenticated;
