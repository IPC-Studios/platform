-- An unassigned lead's alerts went nowhere.
--
-- notifications.recipient_uid is not null, so every CRM alert is written as:
--
--     if v_r.assigned_to is not null then ... create_notification(...)
--
-- A lead nobody has picked up therefore generates silence. The most valuable
-- event in the product — a client accepting a quote at eleven at night — is
-- the one most likely to land on an unassigned lead, because nobody has got
-- to it yet. The studio finds out days later, if at all.
--
-- crm_sla_sweep already knew the answer and did it alone:
--
--     v_to := coalesce(v_r.assigned_to, v_r.owner_user_id);
--
-- One of six paths following the rule is worse than none following it: it
-- reads as deliberate. This applies the same rule everywhere, through one
-- resolver, and fixes a second gap in passing — an assignee who has since
-- been deactivated currently receives alerts nobody will ever read.
--
-- The overdue-follow-up sweep is the exception, and gets a digest instead.
-- It runs over every overdue lead every day, so per-lead fallback would hand
-- the owner fifty notifications on a bad Monday, which is the same as none.

-- ── Who should hear about this lead ──────────────────────────
-- The assignee if they can still act; otherwise the owner; otherwise any
-- active super_admin. Null only if a company has nobody active at all, and
-- then there is genuinely no one to tell.
create or replace function crm_alert_recipient(p_company uuid, p_assignee uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.user_id from users u
      where u.user_id = p_assignee and u.company_id = p_company
        and u.deleted_at is null and u.status = 'active'),
    (select c.owner_user_id from companies c
       join users u on u.user_id = c.owner_user_id and u.company_id = c.id
      where c.id = p_company and u.deleted_at is null and u.status = 'active'),
    (select u.user_id from users u
      where u.company_id = p_company and u.role = 'super_admin'
        and u.deleted_at is null and u.status = 'active'
      order by u.created_at
      limit 1)
  );
$$;

revoke all on function crm_alert_recipient(uuid, uuid) from public, anon;
grant execute on function crm_alert_recipient(uuid, uuid) to authenticated, service_role, anon;

-- ── Quote accepted ──────────────────────────────────────────
-- Unchanged from 0048 apart from the recipient. anon executes this from the
-- public accept page, which is why the resolver is granted to anon too.
create or replace function accept_quote(p_raw text, p_name text, p_email text default null, p_ip text default null, p_user_agent text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_q crm_quotes;
  v_to uuid;
begin
  select id into v_id from crm_quotes q
   where q.status = 'sent'
     and exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                   and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
                   and t.used_at is null and (t.expires_at is null or t.expires_at > now()));
  if v_id is null then return false; end if;
  select * into v_q from crm_quotes where id = v_id;
  if v_q.valid_until is not null and v_q.valid_until < current_date then
    update crm_quotes set status = 'expired' where id = v_id;
    return false;
  end if;
  perform consume_access_token('quote_accept', p_raw);
  update crm_quotes
     set status = 'accepted', accepted_at = now(), accepted_by_name = p_name, accepted_by_email = p_email,
         accepted_ip = p_ip, accepted_user_agent = p_user_agent
   where id = v_id;
  update crm_leads set deal_value = v_q.total where id = v_q.lead_id;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_q.company_id, v_q.lead_id, null, null, null, 'quote ' || v_q.quote_number || ' accepted by ' || coalesce(p_name, 'client'));
  insert into crm_activities (company_id, lead_id, type, direction, subject, actor_id)
  values (v_q.company_id, v_q.lead_id, 'note', 'in', 'Accepted quote ' || v_q.quote_number, null);

  -- Somebody hears about this even when the lead is unassigned: it is a
  -- booking, and it is the event the studio least wants to miss.
  v_to := crm_alert_recipient(v_q.company_id,
                              (select assigned_to from crm_leads where id = v_q.lead_id));
  if v_to is not null then
    perform create_notification(
      v_q.company_id, v_to, 'crm_quote',
      'Quote accepted: ' || v_q.quote_number, coalesce(p_name, 'The client') || ' accepted the quote.',
      'crm_quote_accepted:' || v_q.id::text, 'crm_lead', v_q.lead_id);
  end if;
  return true;
end;
$$;

revoke all on function accept_quote(text, text, text, text, text) from public;
grant execute on function accept_quote(text, text, text, text, text) to anon, authenticated;

-- ── Quote declined ──────────────────────────────────────────
create or replace function decline_quote(p_raw text, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_q crm_quotes;
  v_to uuid;
begin
  select id into v_id from crm_quotes q
   where q.status = 'sent'
     and exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                   and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
                   and t.used_at is null and (t.expires_at is null or t.expires_at > now()));
  if v_id is null then return false; end if;
  select * into v_q from crm_quotes where id = v_id;
  perform consume_access_token('quote_accept', p_raw);
  update crm_quotes set status = 'declined', declined_at = now(), decline_reason = left(p_reason, 500) where id = v_id;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_q.company_id, v_q.lead_id, null, null, null, 'quote ' || v_q.quote_number || ' declined' || case when p_reason is not null then ': ' || left(p_reason, 200) else '' end);

  -- A decline with a reason is the one chance to learn why the studio lost.
  v_to := crm_alert_recipient(v_q.company_id,
                              (select assigned_to from crm_leads where id = v_q.lead_id));
  if v_to is not null then
    perform create_notification(
      v_q.company_id, v_to, 'crm_quote',
      'Quote declined: ' || v_q.quote_number, nullif(left(p_reason, 200), ''),
      'crm_quote_declined:' || v_q.id::text, 'crm_lead', v_q.lead_id);
  end if;
  return true;
end;
$$;

revoke all on function decline_quote(text, text) from public;
grant execute on function decline_quote(text, text) to anon, authenticated;

-- ── Cadence steps ───────────────────────────────────────────
-- Unchanged from 0036 apart from the recipient. A cadence is started by hand
-- on a particular lead, so there is at most one step a day per lead here —
-- no digest needed.
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
  v_to uuid;
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
    v_to := crm_alert_recipient(v_r.company_id, v_r.assigned_to);
    if v_to is not null then
      perform create_notification(
        v_r.company_id, v_to, 'crm_cadence',
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

-- ── Task reminders ──────────────────────────────────────────
-- Already fell back from the task's own assignee to the lead's; now falls
-- back once more rather than dropping. A task somebody wrote down is a
-- commitment, whoever ends up doing it.
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
  v_to uuid;
begin
  for v_r in
    select a.id, a.company_id, a.subject, a.due_at, coalesce(a.assigned_to, l.assigned_to) as who,
           l.name as lead_name, l.phone, a.lead_id
    from crm_activities a
    left join crm_leads l on l.id = a.lead_id
    where a.type = 'task' and a.done_at is null and a.due_at is not null and a.due_at <= now()
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;
    v_to := crm_alert_recipient(v_r.company_id, v_r.who);
    if v_to is null then continue; end if;
    if create_notification(
         v_r.company_id, v_to, 'crm_task',
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

-- ── Overdue follow-ups: one digest, not fifty alerts ─────────
-- Per-lead notifications still go to the assignee. The unassigned ones are
-- counted per company and sent as a single daily line, because the useful
-- fact is "eleven leads are overdue and nobody owns them", not eleven
-- separate names the owner cannot act on individually anyway.
--
-- The rest is unchanged from 0150.
create or replace function run_crm_followup_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_r record;
  v_d record;
  v_overdue int := 0;
  v_notified int := 0;
  v_unassigned int := 0;
  v_digests int := 0;
  v_rules int := 0;
  v_to uuid;
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
    if v_r.assigned_to is null then v_unassigned := v_unassigned + 1; end if;
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

  -- One line per company per day, and only when there is something to say.
  if not p_dry_run then
    for v_d in
      select l.company_id, count(*) as n
        from crm_leads l
       where l.is_archived = false
         and l.status not in ('converted', 'lost')
         and l.assigned_to is null
         and l.follow_up_at is not null
         and l.follow_up_at < now()
       group by l.company_id
    loop
      v_to := crm_alert_recipient(v_d.company_id, null);
      if v_to is not null then
        if create_notification(
             v_d.company_id, v_to, 'crm_overdue',
             v_d.n || case when v_d.n = 1 then ' overdue lead has nobody on it' else ' overdue leads have nobody on them' end,
             'They were promised a follow-up and are not assigned to anyone.',
             'crm_overdue_unassigned:' || current_date::text,
             null, null)
        then
          v_digests := v_digests + 1;
        end if;
      end if;
    end loop;
  end if;

  v_workflows := crm_run_workflows(p_dry_run);

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified,
                                  'unassigned', v_unassigned, 'digests', v_digests,
                                  'rules_applied', v_rules,
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks,
                                  'quotes', v_quotes, 'workflows', v_workflows,
                                  'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
