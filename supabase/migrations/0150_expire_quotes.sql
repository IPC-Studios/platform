-- The quote expiry sweep moves into the CRM cron, and gains a dry run.
--
-- 0048 already had one, and the API called it nightly:
--
--     create function crm_expire_quotes() returns int   -- 0048
--     select crm_expire_quotes() as n                   -- cron/router.ts
--
-- so quotes past their date DID close. What it did not do was run inside
-- run_crm_followup_cron with the cadence, SLA and task sweeps, which meant it
-- was invisible to the cron summary, absent from every dry run, and silent on
-- the lead's own timeline — the studio could see a quote had gone from Sent
-- to Expired but not when, or why nothing had been chased.
--
-- The version below takes p_dry_run, reports due/expired like its siblings,
-- and writes the lapse onto the lead. The old one is DROPPED rather than
-- replaced: `create or replace` cannot change an argument list, so leaving it
-- would give two candidates for the no-argument call in cron/router.ts and
-- Postgres would refuse it —
--
--     function crm_expire_quotes() is not unique   -- 42725
--
-- taking the whole nightly job down with it. The router now reads the count
-- out of the cron summary instead of calling the sweep a second time.

drop function if exists crm_expire_quotes();

create or replace function crm_expire_quotes(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due int := 0;
  v_expired int := 0;
  v_r record;
begin
  select count(*) into v_due
    from crm_quotes
   where status = 'sent' and valid_until is not null and valid_until < current_date;

  if p_dry_run then
    return jsonb_build_object('due', v_due, 'expired', 0, 'dry_run', true);
  end if;

  for v_r in
    select id, company_id, lead_id, quote_number, valid_until
      from crm_quotes
     where status = 'sent' and valid_until is not null and valid_until < current_date
  loop
    update crm_quotes set status = 'expired' where id = v_r.id;
    v_expired := v_expired + 1;
    -- On the lead's own timeline, because "we quoted and heard nothing" is a
    -- fact about the deal, not about the quote row.
    if v_r.lead_id is not null then
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.lead_id, null, null, null,
              'quote ' || v_r.quote_number || ' expired (valid till ' || to_char(v_r.valid_until, 'DD Mon YYYY') || ')');
    end if;
  end loop;

  return jsonb_build_object('due', v_due, 'expired', v_expired, 'dry_run', false);
end;
$$;

revoke all on function crm_expire_quotes(boolean) from public, anon, authenticated;

-- Folded into the nightly run. Unchanged from 0047 apart from the two lines
-- that call the sweep and report it.
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
  v_quotes jsonb;
  v_workflows jsonb;
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);
  v_sla := crm_sla_sweep(p_dry_run);
  v_tasks := crm_task_reminders(p_dry_run);
  v_quotes := crm_expire_quotes(p_dry_run);

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
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks,
                                  'quotes', v_quotes, 'workflows', v_workflows,
                                  'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
