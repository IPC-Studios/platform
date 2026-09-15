-- A cadence's stage and source filters did nothing either.
--
-- 0099 added crm_cadences.stage_filter and .source_filter. The list endpoint
-- can filter BY them, and createCadenceRequest accepts them, but nothing has
-- ever read them to decide whether a cadence applies to a lead — and no screen
-- ever set them, so they were null everywhere regardless.
--
-- What they should mean: "this sequence is written for leads at this stage,
-- from this source". Enforcing that as a hard error on a manual start would be
-- wrong — a person looking at the lead can see what they are doing, and a
-- refusal there is just an obstacle. On the AUTOMATIC path nobody is watching,
-- so a workflow that fires 'start a wedding-enquiry cadence' at a corporate
-- lead should simply not start it.
--
-- So: the workflow action honours the filters, manual starts are unchanged,
-- and the picker in the UI puts matching cadences first.

create or replace function crm_cadence_matches_lead(p_cadence crm_cadences, p_lead crm_leads)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_stage text;
begin
  -- A filter that is null or blank is "no filter", which is the common case.
  if coalesce(p_cadence.source_filter, '') <> ''
     and coalesce(p_lead.source::text, '') <> p_cadence.source_filter then
    return false;
  end if;

  if coalesce(p_cadence.stage_filter, '') = '' then
    return true;
  end if;

  -- The filter is text, and a stage can be named either by the configurable
  -- pipeline stage or by the lead's own status — match either, so a studio
  -- that renamed its pipeline does not silently stop matching.
  select s.name into v_stage from crm_pipeline_stages s where s.id = p_lead.stage_id;
  return p_cadence.stage_filter in (coalesce(v_stage, ''), coalesce(p_lead.status::text, ''));
end;
$$;

revoke all on function crm_cadence_matches_lead(crm_cadences, crm_leads) from public, anon;
grant execute on function crm_cadence_matches_lead(crm_cadences, crm_leads) to authenticated, service_role;

-- The action runner again, with the start_cadence branch checking the filters.
-- Carried from 0133 so the notify routing there is not lost.
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
  v_key text;
  v_role_user uuid;
  v_roles text[];
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
    v_title := coalesce(nullif(p_cfg->>'title', ''), p_wf.name || ': ' || coalesce(p_lead.name, p_lead.phone, 'a lead'));

    -- The cooldown window, as a bucket number. The dedupe key used to carry
    -- now()::date, which pinned every workflow to one notification per
    -- calendar day and made the seeded 2h / 72h / 168h cooldowns behave
    -- identically to 24h.
    -- A cooldown of 0 means "never suppress", so the key has to be unique per
    -- run. A clock reading is not: two actions in the same second round to the
    -- same whole-second bucket and the second one is silently dropped.
    v_key := 'crm_wf:' || p_wf.id::text || ':' || p_lead.id::text || ':'
             || case
                  when coalesce(p_wf.cooldown_hours, 0) <= 0 then gen_random_uuid()::text
                  else floor(extract(epoch from now()) / (p_wf.cooldown_hours * 3600))::bigint::text
                end
             || ':' || coalesce(p_cfg->>'step', '0');

    -- The person who owns the lead. notify_assignee can turn this off for a
    -- rule that is only meant to reach a manager; notify_user names someone
    -- explicitly and is never gated by it.
    v_user := case when v_action = 'notify_user' then nullif(p_cfg->>'user_id', '')::uuid else p_lead.assigned_to end;
    if v_user is not null and (v_action = 'notify_user' or coalesce(p_wf.notify_assignee, true)) then
      perform create_notification(
        p_lead.company_id, v_user, 'crm', v_title, nullif(p_cfg->>'note', ''),
        v_key, 'crm_lead', p_lead.id, p_wf.severity);
    end if;

    -- Whoever the rule routes to by role. 'admin' includes the owner: a
    -- super_admin who is told they are not an admin would be news to them.
    v_roles := coalesce(p_wf.notify_roles, '{}'::text[]);
    if 'admin' = any(v_roles) then v_roles := array_append(v_roles, 'super_admin'); end if;
    if coalesce(array_length(v_roles, 1), 0) > 0 then
      for v_role_user in
        select u.user_id from users u
         where u.company_id = p_lead.company_id
           and u.role::text = any(v_roles)
           and u.status = 'active'
           and (v_user is null or u.user_id <> v_user)
      loop
        perform create_notification(
          p_lead.company_id, v_role_user, 'crm', v_title, nullif(p_cfg->>'note', ''),
          v_key, 'crm_lead', p_lead.id, p_wf.severity);
      end loop;
    end if;
  elsif v_action = 'start_cadence' then
    v_cadence := nullif(p_cfg->>'cadence_id', '')::uuid;
    -- A cadence written for one stage or source should not be started on a
    -- lead from another just because a workflow fired. Nobody is watching the
    -- automatic path, so it skips rather than starting the wrong sequence.
    select s.* into v_step from crm_cadence_steps s
      join crm_cadences c on c.id = s.cadence_id
     where s.cadence_id = v_cadence and c.company_id = p_lead.company_id and c.is_active
       and crm_cadence_matches_lead(c, p_lead)
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
revoke all on function crm_workflow_do_action(crm_leads, jsonb, crm_workflows) from public, anon, authenticated;
