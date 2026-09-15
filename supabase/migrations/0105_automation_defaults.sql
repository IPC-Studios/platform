-- 0103: Automation defaults + reminders parity. Additive, idempotent.
--
-- Lovable ships 7 default CRM automation rules (new_lead_not_contacted,
-- follow_up_overdue, hot_lead_no_follow_up, proposal_no_activity,
-- assigned_no_activity, stage_stuck, unassigned_lead) with cooldown,
-- severity and notify targets. This codebase runs multi-step workflows
-- (crm_workflows); the defaults below are the same 7 situations expressed
-- as one-step workflows, seeded per company by seed_crm_automation_defaults()
-- (called for existing companies here, for new ones by the company trigger,
-- and on demand by POST /crm/workflows/seed).

-- ── reminders: 'general' entity type (Lovable parity) ───────────
alter table reminders drop constraint if exists reminders_entity_type_check;
alter table reminders add constraint reminders_entity_type_check
  check (entity_type is null or entity_type in ('lead', 'project', 'client', 'invoice', 'custom',
                                                'enquiry', 'task', 'shoot', 'general'));

-- ── automation defaults ─────────────────────────────────────────
-- Severity + notify routing + cooldown live on the workflow row so the
-- Automations tab can show them without a second table.
alter table crm_workflows
  add column if not exists severity text not null default 'info'
    check (severity in ('info', 'warning', 'critical')),
  add column if not exists cooldown_hours int not null default 24 check (cooldown_hours between 0 and 720),
  add column if not exists notify_assignee boolean not null default true,
  add column if not exists notify_roles text[] not null default '{}'::text[],
  add column if not exists rule_key text check (rule_key is null or char_length(rule_key) <= 60);

create unique index if not exists crm_workflows_rule_key_idx
  on crm_workflows (company_id, rule_key) where rule_key is not null;

create or replace function seed_crm_automation_defaults(p_company uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_id uuid;
  -- key, name, trigger, condition, action-config, severity, cooldown, notify_roles
  r record;
begin
  for r in
    select * from (values
      ('new_lead_not_contacted', 'New lead not contacted', 'lead_created',
       '{"conditions": [{"field": "days_since_created", "op": "gte", "value": 0}]}'::jsonb,
       '{"action": "notify_assignee", "note": "A new lead is waiting for first contact."}'::jsonb,
       'warning', 2, array['admin', 'manager']::text[]),
      ('follow_overdue', 'Follow-up overdue', 'follow_up_overdue',
       '{}'::jsonb,
       '{"action": "notify_assignee", "note": "This follow-up is overdue."}'::jsonb,
       'warning', 24, array[]::text[]),
      ('hot_no_follow', 'Hot lead has no follow-up', 'lead_created',
       '{"conditions": [{"field": "is_hot", "op": "eq", "value": true}]}'::jsonb,
       '{"action": "set_follow_up_days", "days": 1}'::jsonb,
       'critical', 24, array['admin']::text[]),
      ('proposal_no_act', 'Proposal sent — no activity', 'stage_changed',
       '{"to_status": "proposal_sent", "conditions": [{"field": "activities_7d", "op": "eq", "value": 0}]}'::jsonb,
       '{"action": "notify_assignee", "note": "A proposal has had no activity for 7 days."}'::jsonb,
       'warning', 72, array[]::text[]),
      ('assigned_no_act', 'Assigned lead — no activity', 'lead_created',
       '{"conditions": [{"field": "activities_7d", "op": "eq", "value": 0}]}'::jsonb,
       '{"action": "notify_assignee", "note": "An assigned lead has had no activity for 7 days."}'::jsonb,
       'info', 168, array[]::text[]),
      ('stuck', 'Lead stuck in stage', 'follow_up_overdue',
       '{"conditions": [{"field": "days_since_created", "op": "gte", "value": 14}]}'::jsonb,
       '{"action": "notify_assignee", "note": "This lead has been stuck for 14+ days."}'::jsonb,
       'warning', 168, array['manager']::text[]),
      ('unassigned', 'Unassigned lead', 'lead_created',
       '{}'::jsonb,
       '{"action": "notify_assignee", "note": "A lead arrived with no owner."}'::jsonb,
       'info', 24, array['admin', 'manager']::text[])
    ) as t(rule_key, name, trigger, condition, action_cfg, severity, cooldown, roles)
  loop
    if exists (select 1 from crm_workflows w where w.company_id = p_company and w.rule_key = r.rule_key) then
      continue;
    end if;
    insert into crm_workflows (company_id, name, trigger, condition, is_active,
                               allow_reenroll, exit_on_reply, severity,
                               cooldown_hours, notify_assignee, notify_roles, rule_key)
    values (p_company, r.name, r.trigger, r.condition, true,
            r.trigger = 'follow_up_overdue', true, r.severity,
            r.cooldown, true, r.roles, r.rule_key)
    returning id into v_id;
    insert into crm_workflow_steps (workflow_id, company_id, step_no, kind, config)
    values (v_id, p_company, 1, 'action', r.action_cfg);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function seed_crm_automation_defaults(uuid) from public, anon;

-- Existing studios get the defaults (new rows only — re-runs insert nothing).
do $$
declare c uuid;
begin
  for c in select id from companies loop
    perform seed_crm_automation_defaults(c);
  end loop;
end $$;

-- New studios get them at creation, next to the pipeline + scoring seeds.
create or replace function companies_seed_crm_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform crm_ensure_default_pipeline(new.id);
  perform crm_ensure_scoring_defaults(new.id);
  perform seed_crm_automation_defaults(new.id);
  return null;
end;
$$;
