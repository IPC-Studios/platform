-- 0040: CRM workflows — multi-step automations with delays and branches,
-- enrollment that exits on a reply, an outbox for template sends, and lead
-- scoring.
--
-- 0035's crm_automation_rules were one trigger, one condition, one action.
-- A workflow is the same trigger and condition followed by a list of steps:
-- an action, a wait, a branch on the lead's fields, or an exit. Every rule
-- that exists becomes a one-step workflow here, the old evaluation stops,
-- and the rules table stays only as the record of what was migrated.

-- ══════════════════════════════════════════════════════════════
-- 1. Tables
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_workflows (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  name           text not null check (char_length(name) between 2 and 80),
  trigger        text not null check (trigger in ('lead_created', 'stage_changed', 'follow_up_overdue', 'activity_logged', 'score_changed', 'manual')),
  -- {source?, to_status?, from_status?, is_hot?, conditions?: [{field, op, value}]}
  condition      jsonb not null default '{}'::jsonb,
  is_active      boolean not null default true,
  -- May a lead go through this workflow more than once?
  allow_reenroll boolean not null default false,
  -- A reply from the lead (an inbound activity) ends the enrollment.
  exit_on_reply  boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists crm_workflows_company_idx on crm_workflows (company_id, is_active, trigger);
drop trigger if exists crm_workflows_set_updated_at on crm_workflows;
create trigger crm_workflows_set_updated_at before update on crm_workflows
  for each row execute function set_updated_at();

create table if not exists crm_workflow_steps (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references crm_workflows (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  step_no     int not null check (step_no between 1 and 100),
  kind        text not null check (kind in ('action', 'delay', 'branch', 'exit')),
  -- action: {action, ...value}   delay: {amount, unit}
  -- branch: {conditions, yes_step, no_step}   exit: {}
  config      jsonb not null default '{}'::jsonb,
  unique (workflow_id, step_no)
);

create table if not exists crm_workflow_enrollments (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references crm_workflows (id) on delete cascade,
  lead_id      uuid not null references crm_leads (id) on delete cascade,
  company_id   uuid not null references companies (id) on delete cascade,
  current_step int not null default 1,
  next_at      timestamptz,
  status       text not null default 'active' check (status in ('active', 'completed', 'exited', 'errored')),
  exit_reason  text,
  steps_run    int not null default 0,
  log          jsonb not null default '[]'::jsonb,
  enrolled_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists crm_workflow_enrollments_active_idx on crm_workflow_enrollments (workflow_id, lead_id) where status = 'active';
create index if not exists crm_workflow_enrollments_due_idx on crm_workflow_enrollments (next_at) where status = 'active';
create index if not exists crm_workflow_enrollments_lead_idx on crm_workflow_enrollments (lead_id, enrolled_at desc);
drop trigger if exists crm_workflow_enrollments_set_updated_at on crm_workflow_enrollments;
create trigger crm_workflow_enrollments_set_updated_at before update on crm_workflow_enrollments
  for each row execute function set_updated_at();

-- A template a workflow asked to send. The API drains this on the hourly
-- tick: through the WhatsApp Cloud API when the studio has it, otherwise as
-- a task for the deal's owner. Nothing in the database pretends to send.
create table if not exists crm_outbox (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  lead_id     uuid not null references crm_leads (id) on delete cascade,
  template_id uuid not null references crm_templates (id) on delete cascade,
  channel     text not null check (channel in ('whatsapp', 'email')),
  status      text not null default 'pending' check (status in ('pending', 'sent', 'manual', 'failed')),
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists crm_outbox_pending_idx on crm_outbox (created_at) where status = 'pending';

create table if not exists crm_scoring_rules (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  label      text not null check (char_length(label) between 2 and 80),
  field      text not null,
  op         text not null default 'eq' check (op in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null', 'not_null')),
  value      jsonb,
  points     int not null check (points between -100 and 100),
  is_active  boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

alter table crm_leads add column if not exists score_adjust int not null default 0;
alter table crm_settings add column if not exists hot_score int not null default 60 check (hot_score between 1 and 1000);

alter table crm_workflows            enable row level security;
alter table crm_workflow_steps       enable row level security;
alter table crm_workflow_enrollments enable row level security;
alter table crm_outbox               enable row level security;
alter table crm_scoring_rules        enable row level security;
do $$
declare t text;
begin
  foreach t in array array['crm_workflows', 'crm_workflow_steps', 'crm_workflow_enrollments', 'crm_outbox', 'crm_scoring_rules'] loop
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

-- ══════════════════════════════════════════════════════════════
-- 2. Conditions over a lead's facts
-- ══════════════════════════════════════════════════════════════
-- The row plus the derived facts a rule may ask about.
create or replace function crm_lead_facts(p_lead crm_leads)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p_lead) || jsonb_build_object(
    'has_email', p_lead.email is not null,
    'has_phone', p_lead.phone_norm is not null,
    'days_since_created', floor(extract(epoch from (now() - p_lead.created_at)) / 86400)::int,
    'days_since_contact', case when p_lead.last_contacted_at is null then null
                               else floor(extract(epoch from (now() - p_lead.last_contacted_at)) / 86400)::int end,
    'inbound_replies', (select count(*) from crm_activities a where a.lead_id = p_lead.id and a.direction = 'in'),
    'activities_7d', (select count(*) from crm_activities a where a.lead_id = p_lead.id and a.created_at > now() - interval '7 days'),
    'open_tasks', (select count(*) from crm_activities a where a.lead_id = p_lead.id and a.type = 'task' and a.done_at is null),
    'stage_key', (select s.key from crm_pipeline_stages s where s.id = p_lead.stage_id),
    'stage_kind', (select s.kind from crm_pipeline_stages s where s.id = p_lead.stage_id),
    'contact_lifecycle', (select c.lifecycle from crm_contacts c where c.id = p_lead.contact_id)
  )
$$;
-- Definer, and it counts rows for whatever lead row it is handed, so it stays
-- internal: crm_cond_matches() and crm_score_lead() are the only callers.
revoke all on function crm_lead_facts(crm_leads) from public, anon, authenticated;

-- One comparison. Numbers compare as numbers, everything else as text
-- (ISO dates sort correctly as text).
create or replace function crm_cond_op(p_left jsonb, p_op text, p_right jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  l text := p_left #>> '{}';
  r text := p_right #>> '{}';
  ln numeric;
  rn numeric;
begin
  if p_op = 'is_null' then return p_left is null or jsonb_typeof(p_left) = 'null'; end if;
  if p_op = 'not_null' then return p_left is not null and jsonb_typeof(p_left) <> 'null'; end if;
  if p_left is null or jsonb_typeof(p_left) = 'null' then return false; end if;
  if p_op = 'in' then
    return jsonb_typeof(p_right) = 'array'
       and exists (select 1 from jsonb_array_elements(p_right) e where e #>> '{}' = l);
  end if;
  if p_op = 'contains' then return position(lower(coalesce(r, '')) in lower(coalesce(l, ''))) > 0; end if;
  if jsonb_typeof(p_left) in ('number', 'boolean') and jsonb_typeof(p_right) in ('number', 'boolean') then
    ln := case when jsonb_typeof(p_left) = 'boolean' then (case when l = 'true' then 1 else 0 end) else l::numeric end;
    rn := case when jsonb_typeof(p_right) = 'boolean' then (case when r = 'true' then 1 else 0 end) else r::numeric end;
    return case p_op when 'eq' then ln = rn when 'neq' then ln <> rn when 'gt' then ln > rn
                     when 'gte' then ln >= rn when 'lt' then ln < rn when 'lte' then ln <= rn else false end;
  end if;
  if jsonb_typeof(p_left) = 'number' and r ~ '^-?[0-9]+(\.[0-9]+)?$' then
    ln := l::numeric; rn := r::numeric;
    return case p_op when 'eq' then ln = rn when 'neq' then ln <> rn when 'gt' then ln > rn
                     when 'gte' then ln >= rn when 'lt' then ln < rn when 'lte' then ln <= rn else false end;
  end if;
  return case p_op when 'eq' then l = r when 'neq' then l is distinct from r when 'gt' then l > r
                   when 'gte' then l >= r when 'lt' then l < r when 'lte' then l <= r else false end;
end;
$$;

-- The legacy keys (source / to_status / from_status / is_hot) plus a list of
-- {field, op, value}; every clause must hold. Empty matches everything.
create or replace function crm_cond_matches(p_cond jsonb, p_lead crm_leads, p_from_status text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_facts jsonb;
  c jsonb;
begin
  if p_cond is null or p_cond = '{}'::jsonb then return true; end if;
  if p_cond ? 'source' and p_cond->>'source' is not null and p_cond->>'source' <> p_lead.source then return false; end if;
  if p_cond ? 'to_status' and p_cond->>'to_status' is not null and p_cond->>'to_status' <> p_lead.status then return false; end if;
  if p_cond ? 'from_status' and p_cond->>'from_status' is not null and p_cond->>'from_status' is distinct from p_from_status then return false; end if;
  if p_cond ? 'is_hot' and p_cond->>'is_hot' is not null and (p_cond->>'is_hot')::boolean <> p_lead.is_hot then return false; end if;
  if jsonb_typeof(p_cond->'conditions') = 'array' and jsonb_array_length(p_cond->'conditions') > 0 then
    v_facts := crm_lead_facts(p_lead);
    for c in select * from jsonb_array_elements(p_cond->'conditions') loop
      if not crm_cond_op(v_facts -> (c->>'field'), coalesce(c->>'op', 'eq'), c->'value') then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;
revoke all on function crm_cond_matches(jsonb, crm_leads, text) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. Scoring
-- ══════════════════════════════════════════════════════════════
create or replace function crm_ensure_scoring_defaults(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from crm_scoring_rules where company_id = p_company) then return; end if;
  insert into crm_scoring_rules (company_id, label, field, op, value, points, position) values
    (p_company, 'Has an email address', 'has_email', 'eq', 'true'::jsonb, 10, 0),
    (p_company, 'Came by referral', 'source', 'eq', '"referral"'::jsonb, 15, 1),
    (p_company, 'Deal worth 50,000 or more', 'deal_value', 'gte', '50000'::jsonb, 20, 2),
    (p_company, 'Has replied', 'inbound_replies', 'gte', '1'::jsonb, 25, 3),
    (p_company, 'Active this week', 'activities_7d', 'gte', '1'::jsonb, 10, 4),
    (p_company, 'Marked hot', 'is_hot', 'eq', 'true'::jsonb, 20, 5),
    (p_company, 'Gone quiet for 14 days', 'days_since_contact', 'gte', '14'::jsonb, -15, 6);
end;
$$;
revoke all on function crm_ensure_scoring_defaults(uuid) from public, anon, authenticated;

create or replace function companies_seed_crm_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform crm_ensure_default_pipeline(new.id);
  perform crm_ensure_scoring_defaults(new.id);
  return null;
end;
$$;
do $$
declare c uuid;
begin
  for c in select id from companies loop
    perform crm_ensure_scoring_defaults(c);
  end loop;
end $$;

-- The three entry points below take a bare id and run as definer, so each one
-- checks the caller. A session that belongs to a studio may only touch that
-- studio's rows; a caller with no studio in scope — the cron as service_role,
-- and the anon webhook path that inserts leads — is left alone, because those
-- run on behalf of every tenant by design.
-- Recompute one lead's score from the studio's rules plus any workflow
-- adjustment. Returns the new score; enrolls 'score_changed' workflows when
-- it moved.
create or replace function crm_score_lead(p_lead uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead    crm_leads;
  v_facts   jsonb;
  v_score   int := 0;
  v_company uuid := get_current_company_id();
  r crm_scoring_rules;
begin
  select * into v_lead from crm_leads where id = p_lead;
  if not found then return 0; end if;
  if v_company is not null and v_company is distinct from v_lead.company_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_facts := crm_lead_facts(v_lead);
  for r in select * from crm_scoring_rules where company_id = v_lead.company_id and is_active loop
    if crm_cond_op(v_facts -> r.field, r.op, r.value) then v_score := v_score + r.points; end if;
  end loop;
  v_score := greatest(0, v_score + v_lead.score_adjust);
  if v_score <> v_lead.score then
    update crm_leads set score = v_score where id = p_lead;
    perform crm_enroll_workflows(p_lead, 'score_changed', v_lead.score::text);
  end if;
  return v_score;
end;
$$;
revoke all on function crm_score_lead(uuid) from public, anon;
grant execute on function crm_score_lead(uuid) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════
-- 4. Running a workflow
-- ══════════════════════════════════════════════════════════════
create or replace function crm_workflow_do_action(p_lead crm_leads, p_cfg jsonb, p_wf crm_workflows)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := p_cfg->>'action';
  v_title text;
  v_cadence uuid;
  v_step crm_cadence_steps;
  v_next timestamptz;
  v_stage crm_pipeline_stages;
  v_user uuid;
begin
  if v_action = 'assign_to' then
    update crm_leads set assigned_to = nullif(p_cfg->>'user_id', '')::uuid where id = p_lead.id;
  elsif v_action = 'set_follow_up_days' then
    update crm_leads
       set follow_up_at = date_trunc('day', now()) + make_interval(days => coalesce((p_cfg->>'days')::int, 1)) + interval '10 hours'
     where id = p_lead.id;
  elsif v_action = 'mark_hot' then
    update crm_leads set is_hot = true where id = p_lead.id;
  elsif v_action = 'add_note' then
    update crm_leads
       set notes = nullif(trim(coalesce(notes, '') || chr(10) || coalesce(p_cfg->>'note', '')), '')
     where id = p_lead.id;
  elsif v_action in ('notify_assignee', 'notify_user') then
    v_user := case when v_action = 'notify_user' then nullif(p_cfg->>'user_id', '')::uuid else p_lead.assigned_to end;
    if v_user is not null then
      v_title := coalesce(nullif(p_cfg->>'title', ''), p_wf.name || ': ' || coalesce(p_lead.name, p_lead.phone, 'a lead'));
      perform create_notification(
        p_lead.company_id, v_user, 'crm', v_title, nullif(p_cfg->>'note', ''),
        'crm_wf:' || p_wf.id::text || ':' || p_lead.id::text || ':' || now()::date::text || ':' || coalesce(p_cfg->>'step', '0'),
        'crm_lead', p_lead.id);
    end if;
  elsif v_action = 'start_cadence' then
    v_cadence := nullif(p_cfg->>'cadence_id', '')::uuid;
    select s.* into v_step from crm_cadence_steps s
      join crm_cadences c on c.id = s.cadence_id
     where s.cadence_id = v_cadence and c.company_id = p_lead.company_id and c.is_active
     order by s.step_no limit 1;
    if found then
      v_next := greatest(crm_cadence_step_time(now(), v_step.day_offset), now() + interval '5 minutes');
      insert into crm_lead_cadences (lead_id, company_id, cadence_id, step_no, next_at)
      values (p_lead.id, p_lead.company_id, v_cadence, v_step.step_no, v_next)
      on conflict (lead_id) do nothing;
      if found then update crm_leads set follow_up_at = v_next where id = p_lead.id; end if;
    end if;
  elsif v_action = 'set_stage' then
    select * into v_stage from crm_pipeline_stages where id = nullif(p_cfg->>'stage_id', '')::uuid and company_id = p_lead.company_id;
    if found and v_stage.pipeline_id = p_lead.pipeline_id then
      update crm_leads
         set stage_id = v_stage.id,
             lost_reason = case when v_stage.kind = 'lost' then coalesce(nullif(p_cfg->>'lost_reason', ''), lost_reason, 'Closed by workflow') else null end
       where id = p_lead.id;
    end if;
  elsif v_action = 'create_task' then
    insert into crm_activities (company_id, lead_id, type, subject, due_at, assigned_to, actor_id)
    values (p_lead.company_id, p_lead.id, 'task', coalesce(nullif(p_cfg->>'subject', ''), 'Follow up'),
            now() + make_interval(days => coalesce((p_cfg->>'days')::int, 0)),
            coalesce(nullif(p_cfg->>'user_id', '')::uuid, p_lead.assigned_to), null);
  elsif v_action = 'add_score' then
    update crm_leads set score_adjust = score_adjust + coalesce((p_cfg->>'points')::int, 0) where id = p_lead.id;
  elsif v_action = 'send_template' then
    if exists (select 1 from crm_templates t where t.id = nullif(p_cfg->>'template_id', '')::uuid and t.company_id = p_lead.company_id) then
      insert into crm_outbox (company_id, lead_id, template_id, channel)
      values (p_lead.company_id, p_lead.id, (p_cfg->>'template_id')::uuid, coalesce(nullif(p_cfg->>'channel', ''), 'whatsapp'));
    end if;
  else
    raise exception 'unknown workflow action %', v_action using errcode = '22023';
  end if;
  return v_action;
end;
$$;
-- It writes against whatever lead row it is handed, so it must never be
-- callable directly: crm_run_enrollment() is the only caller.
revoke all on function crm_workflow_do_action(crm_leads, jsonb, crm_workflows) from public, anon, authenticated;

-- Execute an enrollment from its current step until it waits, exits or
-- finishes. Every step is appended to the enrollment's log.
create or replace function crm_run_enrollment(p_enrollment uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e    crm_workflow_enrollments;
  v_wf   crm_workflows;
  v_lead crm_leads;
  v_step crm_workflow_steps;
  v_next int;
  v_guard int := 0;
  v_result text;
  v_amount int;
  v_unit text;
  v_explicit boolean;
  v_company uuid := get_current_company_id();
begin
  select * into v_e from crm_workflow_enrollments where id = p_enrollment and status = 'active';
  if not found then return 'skipped'; end if;
  if v_company is not null and v_company is distinct from v_e.company_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_wf from crm_workflows where id = v_e.workflow_id;
  if not found or not v_wf.is_active then
    update crm_workflow_enrollments set status = 'exited', exit_reason = 'workflow off', next_at = null where id = p_enrollment;
    return 'exited';
  end if;

  begin
    loop
      v_guard := v_guard + 1;
      if v_guard > 50 then raise exception 'workflow loop' using errcode = '22023'; end if;
      select * into v_lead from crm_leads where id = v_e.lead_id;
      if not found then
        update crm_workflow_enrollments set status = 'exited', exit_reason = 'lead gone', next_at = null where id = p_enrollment;
        return 'exited';
      end if;
      select * into v_step from crm_workflow_steps where workflow_id = v_wf.id and step_no = v_e.current_step;
      if not found then
        update crm_workflow_enrollments set status = 'completed', next_at = null where id = p_enrollment;
        return 'completed';
      end if;

      v_next := v_e.current_step + 1;
      if v_step.kind = 'action' then
        v_result := crm_workflow_do_action(v_lead, v_step.config || jsonb_build_object('step', v_step.step_no), v_wf);
        insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
        values (v_lead.company_id, v_lead.id, null, null, null, 'workflow: ' || v_wf.name || case when v_result is not null then ' · ' || v_result else '' end);
      elsif v_step.kind = 'delay' then
        v_amount := greatest(1, coalesce((v_step.config->>'amount')::int, 1));
        v_unit := coalesce(v_step.config->>'unit', 'days');
        update crm_workflow_enrollments
           set current_step = v_next,
               next_at = now() + case v_unit when 'minutes' then make_interval(mins => v_amount)
                                             when 'hours' then make_interval(hours => v_amount)
                                             else make_interval(days => v_amount) end,
               steps_run = steps_run + 1,
               log = log || jsonb_build_object('step', v_step.step_no, 'kind', 'delay', 'at', now())
         where id = p_enrollment;
        return 'waiting';
      elsif v_step.kind = 'branch' then
        if crm_cond_matches(jsonb_build_object('conditions', coalesce(v_step.config->'conditions', '[]'::jsonb)), v_lead, null) then
          v_explicit := (v_step.config->>'yes_step') is not null;
          v_next := coalesce((v_step.config->>'yes_step')::int, v_e.current_step + 1);
          v_result := 'yes';
        else
          v_explicit := (v_step.config->>'no_step') is not null;
          v_next := coalesce((v_step.config->>'no_step')::int, v_e.current_step + 1);
          v_result := 'no';
        end if;
        -- Falling off the end is how a workflow finishes, so an implicit
        -- "next step" that does not exist is fine. A branch that NAMES a step
        -- which was since deleted is a broken workflow, and saying so beats
        -- marking the enrollment complete as though the branch had run.
        if v_explicit and not exists (
          select 1 from crm_workflow_steps s where s.workflow_id = v_wf.id and s.step_no = v_next
        ) then
          raise exception 'step % branches to step %, which does not exist', v_step.step_no, v_next using errcode = '22023';
        end if;
      elsif v_step.kind = 'exit' then
        update crm_workflow_enrollments
           set status = 'completed', next_at = null, steps_run = steps_run + 1,
               log = log || jsonb_build_object('step', v_step.step_no, 'kind', 'exit', 'at', now())
         where id = p_enrollment;
        return 'completed';
      end if;

      update crm_workflow_enrollments
         set current_step = v_next, steps_run = steps_run + 1,
             log = log || jsonb_build_object('step', v_step.step_no, 'kind', v_step.kind, 'result', v_result, 'at', now())
       where id = p_enrollment
       returning * into v_e;
    end loop;
  exception when others then
    update crm_workflow_enrollments set status = 'errored', exit_reason = left(sqlerrm, 300), next_at = null where id = p_enrollment;
    return 'errored';
  end;
end;
$$;
revoke all on function crm_run_enrollment(uuid) from public, anon;
grant execute on function crm_run_enrollment(uuid) to authenticated, service_role;

-- Enroll a lead in every active workflow for a trigger whose condition it
-- meets, and run each one straight away (a delay is the usual first pause).
create or replace function crm_enroll_workflows(p_lead uuid, p_trigger text, p_from_status text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead crm_leads;
  v_wf crm_workflows;
  v_id uuid;
  v_n int := 0;
  v_company uuid := get_current_company_id();
begin
  select * into v_lead from crm_leads where id = p_lead;
  if not found then return 0; end if;
  if v_company is not null and v_company is distinct from v_lead.company_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_wf in
    select * from crm_workflows
    where company_id = v_lead.company_id and is_active and trigger = p_trigger
    order by created_at
  loop
    if not crm_cond_matches(v_wf.condition, v_lead, p_from_status) then continue; end if;
    if exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead.id and e.status = 'active') then continue; end if;
    if p_trigger = 'follow_up_overdue' then
      -- The hourly sweep asks again every hour; once a day is enough.
      if exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead.id and e.enrolled_at::date = current_date) then continue; end if;
    elsif not v_wf.allow_reenroll and exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead.id) then
      continue;
    end if;
    insert into crm_workflow_enrollments (workflow_id, lead_id, company_id, next_at)
    values (v_wf.id, v_lead.id, v_lead.company_id, now())
    returning id into v_id;
    perform crm_run_enrollment(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function crm_enroll_workflows(uuid, text, text) from public, anon;
grant execute on function crm_enroll_workflows(uuid, text, text) to authenticated, service_role;

-- Manual enrollment by a person: any active workflow, re-enrollment allowed.
create or replace function crm_enroll_manual(p_workflow uuid, p_leads uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_wf crm_workflows;
  v_lead uuid;
  v_id uuid;
  v_n int := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_wf from crm_workflows where id = p_workflow and company_id = v_company;
  if not found then raise exception 'unknown workflow' using errcode = '42501'; end if;
  foreach v_lead in array p_leads loop
    if not exists (select 1 from crm_leads where id = v_lead and company_id = v_company) then continue; end if;
    if exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead and e.status = 'active') then continue; end if;
    insert into crm_workflow_enrollments (workflow_id, lead_id, company_id, next_at)
    values (v_wf.id, v_lead, v_company, now())
    returning id into v_id;
    perform crm_run_enrollment(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function crm_enroll_manual(uuid, uuid[]) from public, anon;
grant execute on function crm_enroll_manual(uuid, uuid[]) to authenticated;

-- Due enrollments, on the hourly tick.
create or replace function crm_run_workflows(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_due int := 0;
  v_ran int := 0;
  v_completed int := 0;
  v_errored int := 0;
  v_result text;
begin
  for v_r in
    select e.id from crm_workflow_enrollments e
    where e.status = 'active' and e.next_at is not null and e.next_at <= now()
    order by e.next_at
    limit 500
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;
    v_result := crm_run_enrollment(v_r.id);
    v_ran := v_ran + 1;
    if v_result = 'completed' then v_completed := v_completed + 1; end if;
    if v_result = 'errored' then v_errored := v_errored + 1; end if;
  end loop;
  return jsonb_build_object('due', v_due, 'ran', v_ran, 'completed', v_completed, 'errored', v_errored);
end;
$$;
revoke all on function crm_run_workflows(boolean) from public, anon;
grant execute on function crm_run_workflows(boolean) to service_role;

-- ══════════════════════════════════════════════════════════════
-- 5. Hooks: the lead trigger, the reply, the sweep
-- ══════════════════════════════════════════════════════════════
-- The row trigger now enrolls workflows instead of applying rules. Depth-
-- guarded as before: a step's own UPDATE must not re-enter.
create or replace function crm_leads_automations_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'INSERT' then
    perform crm_enroll_workflows(new.id, 'lead_created', null);
    perform crm_score_lead(new.id);
  else
    if new.status is distinct from old.status then
      perform crm_enroll_workflows(new.id, 'stage_changed', old.status);
    end if;
    perform crm_score_lead(new.id);
  end if;
  return null;
end;
$$;

-- An inbound activity ends every enrollment that asked to stop on a reply,
-- then recomputes the score; any activity can start an 'activity_logged'
-- workflow.
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
    if new.direction in ('in', 'out') then
      update crm_leads set last_contacted_at = coalesce(last_contacted_at, coalesce(new.started_at, new.created_at))
       where id = new.lead_id;
    end if;
    if new.direction = 'in' then
      update crm_lead_cadences lc
         set stopped_at = now()
       where lc.lead_id = new.lead_id and lc.stopped_at is null and lc.completed_at is null
      returning (select name from crm_cadences where id = lc.cadence_id) into v_stopped;
      if v_stopped is not null then
        insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
        values (new.company_id, new.lead_id, null, null, null, 'replied via ' || new.type || ' · cadence stopped: ' || v_stopped);
      end if;
      update crm_workflow_enrollments e
         set status = 'exited', exit_reason = 'replied', next_at = null
        from crm_workflows w
       where w.id = e.workflow_id and e.lead_id = new.lead_id and e.status = 'active' and w.exit_on_reply;
    end if;
  end if;
  if pg_trigger_depth() <= 1 then
    perform crm_enroll_workflows(new.lead_id, 'activity_logged', new.type);
    perform crm_score_lead(new.lead_id);
  end if;
  return null;
end;
$$;

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
  v_workflows jsonb;
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
    v_rules := v_rules + crm_enroll_workflows(v_r.id, 'follow_up_overdue', null);
  end loop;

  v_workflows := crm_run_workflows(p_dry_run);

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified, 'rules_applied', v_rules,
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks, 'workflows', v_workflows,
                                  'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. Migrate the rules, retire the rule engine
-- ══════════════════════════════════════════════════════════════
do $$
declare r crm_automation_rules;
        v_id uuid;
begin
  for r in select * from crm_automation_rules where not exists (
    select 1 from crm_workflows w where w.company_id = crm_automation_rules.company_id and w.name = crm_automation_rules.name
  ) loop
    insert into crm_workflows (company_id, name, trigger, condition, is_active, allow_reenroll, exit_on_reply, created_at)
    values (r.company_id, r.name, r.trigger, r.condition, r.is_active, r.trigger = 'follow_up_overdue', false, r.created_at)
    returning id into v_id;
    insert into crm_workflow_steps (workflow_id, company_id, step_no, kind, config)
    values (v_id, r.company_id, 1, 'action', jsonb_build_object('action', r.action) || r.action_value);
  end loop;
  update crm_automation_rules set is_active = false where is_active;
end $$;

-- The outbox the API drains: claim pending rows as the service.
create or replace function crm_outbox_claim(p_limit int default 100)
returns table (id uuid, company_id uuid, lead_id uuid, template_id uuid, channel text)
language sql
security definer
set search_path = public
as $$
  select o.id, o.company_id, o.lead_id, o.template_id, o.channel
  from crm_outbox o
  where o.status = 'pending'
  order by o.created_at
  limit greatest(1, least(p_limit, 500));
$$;
revoke all on function crm_outbox_claim(int) from public, anon, authenticated;
grant execute on function crm_outbox_claim(int) to service_role;
