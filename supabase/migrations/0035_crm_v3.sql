-- 0035: CRM v3 — reversible merges, atomic imports, ranged reports, a team
-- view, undoable bulk edits, automations — and attendance corrections.
-- Additive: nothing here renames or drops a table; two functions change
-- signature and are dropped-and-recreated.

-- ══════════════════════════════════════════════════════════════
-- CRM: leads carry where they were merged
-- ══════════════════════════════════════════════════════════════
alter table crm_leads
  add column if not exists merged_into uuid references crm_leads (id) on delete set null;
create index if not exists crm_leads_merged_into_idx on crm_leads (merged_into) where merged_into is not null;

-- ── duplicates: groups now carry the leads themselves ─────────
-- The inbox hides archived rows, so the client could not name a duplicate it
-- was about to merge. The group answers with what the row IS.
drop function if exists crm_duplicate_groups();
create or replace function crm_duplicate_groups()
returns table (phone_norm text, lead_ids uuid[], lead_count int, leads jsonb)
language sql
security definer
set search_path = public
as $$
  select l.phone_norm,
         array_agg(l.id order by l.created_at),
         count(*)::int,
         jsonb_agg(jsonb_build_object(
           'id', l.id, 'name', l.name, 'phone', l.phone, 'status', l.status,
           'source', l.source, 'created_at', l.created_at, 'notes', l.notes
         ) order by l.created_at)
  from crm_leads l
  where l.company_id = get_current_company_id()
    and l.phone_norm is not null
    and l.is_archived = false
  group by l.phone_norm
  having count(*) > 1
  order by count(*) desc
  limit 50;
$$;
revoke all on function crm_duplicate_groups() from public, anon;
grant execute on function crm_duplicate_groups() to authenticated;

-- ── merge: archive the duplicates, remember the survivor ──────
-- 0032 also forced every duplicate to 'lost', which inflated the lost count
-- with rows that were never a conversation of their own. Status is left as
-- it was; merged_into is what says "this row folded into that one".
create or replace function merge_leads(p_survivor uuid, p_duplicates uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
  v_notes text;
  v_merged int := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_survivor = any(p_duplicates) then
    raise exception 'survivor cannot be in duplicates' using errcode = '22023';
  end if;
  if not exists (select 1 from crm_leads where id = p_survivor and company_id = v_company) then
    raise exception 'unknown survivor' using errcode = '42501';
  end if;

  foreach v_id in array p_duplicates loop
    select notes into v_notes from crm_leads where id = v_id and company_id = v_company and is_archived = false;
    if not found then continue; end if;
    if v_notes is not null and char_length(trim(v_notes)) > 0 then
      update crm_leads
         set notes = coalesce(notes, '') || chr(10) || '[merged from ' || v_id::text || '] ' || v_notes
       where id = p_survivor;
    end if;
    update crm_leads
       set is_archived = true, archived_at = now(), merged_into = p_survivor
     where id = v_id and company_id = v_company;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_survivor, null, null, auth.uid(), 'merged duplicate ' || v_id::text);
    v_merged := v_merged + 1;
  end loop;
  return v_merged;
end;
$$;

-- ── unmerge: put the duplicates back ──────────────────────────
create or replace function unmerge_leads(p_survivor uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_row crm_leads;
  v_restored int := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_row in
    select * from crm_leads where merged_into = p_survivor and company_id = v_company
  loop
    update crm_leads
       set is_archived = false, archived_at = null, merged_into = null
     where id = v_row.id;
    -- The line merge appended to the survivor goes with it.
    update crm_leads
       set notes = nullif(trim(regexp_replace(coalesce(notes, ''),
                     '\n?\[merged from ' || v_row.id::text || '\][^\n]*', '', 'g')), '')
     where id = p_survivor;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_survivor, null, null, auth.uid(), 'unmerged ' || v_row.id::text);
    v_restored := v_restored + 1;
  end loop;
  return v_restored;
end;
$$;
revoke all on function unmerge_leads(uuid) from public, anon;
grant execute on function unmerge_leads(uuid) to authenticated;

-- ── import: one transaction, duplicates counted honestly ──────
-- add_lead() hands back the EXISTING row for a known number, which the old
-- import counted as a fresh lead. Here a known number is either skipped, or
-- inserted beside the existing row so the duplicates tab can merge it.
create or replace function crm_import_leads(p_rows jsonb, p_skip_duplicates boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_row      jsonb;
  v_norm     text;
  v_existing uuid;
  v_assignee uuid;
  v_id       uuid;
  v_created  int := 0;
  v_skipped  int := 0;
  v_invalid  int := 0;
  v_ids      uuid[] := '{}';
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be an array of at most 500' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_norm := crm_normalize_phone(v_row->>'phone');
    if v_norm is null then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    select id into v_existing from crm_leads
      where company_id = v_company and phone_norm = v_norm and is_archived = false
      limit 1;
    if found and p_skip_duplicates then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_assignee := nullif(v_row->>'assigned_to', '')::uuid;
    if v_assignee is null then
      select r.user_id into v_assignee
        from crm_distribution_rules r
        where r.company_id = v_company and r.is_active
        order by (
          select count(*) from crm_leads l
          where l.company_id = v_company and l.assigned_to = r.user_id
        ) asc, r.priority asc
        limit 1;
    end if;

    insert into crm_leads (company_id, name, phone, phone_norm, email, source, notes, assigned_to, source_key)
    values (
      v_company,
      nullif(v_row->>'name', ''),
      v_row->>'phone',
      v_norm,
      nullif(v_row->>'email', ''),
      coalesce(nullif(v_row->>'source', ''), 'manual'),
      nullif(v_row->>'notes', ''),
      v_assignee,
      'csv_import'
    )
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'invalid', v_invalid, 'ids', to_jsonb(v_ids));
end;
$$;
revoke all on function crm_import_leads(jsonb, boolean) from public, anon;
grant execute on function crm_import_leads(jsonb, boolean) to authenticated;

-- ── bulk edit with a snapshot for undo ────────────────────────
create or replace function crm_bulk_patch(p_ids uuid[], p_patch jsonb)
returns table (id uuid, status text, assigned_to uuid, is_hot boolean, follow_up_at timestamptz, is_archived boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('new','contacted','qualified','proposal_sent','converted','lost') then
    raise exception 'unknown status' using errcode = '22023';
  end if;

  -- What the rows looked like before, handed back so the change can be undone.
  return query
    select l.id, l.status, l.assigned_to, l.is_hot, l.follow_up_at, l.is_archived
    from crm_leads l
    where l.id = any(p_ids) and l.company_id = v_company;

  update crm_leads l
     set status = coalesce(p_patch->>'status', l.status),
         assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else l.assigned_to end,
         is_hot = coalesce((p_patch->>'is_hot')::boolean, l.is_hot),
         follow_up_at = case when p_patch ? 'follow_up_at' then nullif(p_patch->>'follow_up_at', '')::timestamptz else l.follow_up_at end,
         is_archived = coalesce((p_patch->>'is_archived')::boolean, l.is_archived),
         converted_at = case
           when p_patch->>'status' = 'converted' then coalesce(l.converted_at, now())
           when p_patch ? 'status' and p_patch->>'status' <> 'converted' then null
           else l.converted_at end,
         last_contacted_at = case
           when p_patch ? 'status' and p_patch->>'status' <> 'new' then coalesce(l.last_contacted_at, now())
           else l.last_contacted_at end
   where l.id = any(p_ids) and l.company_id = v_company;
end;
$$;
revoke all on function crm_bulk_patch(uuid[], jsonb) from public, anon;
grant execute on function crm_bulk_patch(uuid[], jsonb) to authenticated;

-- Undo: each row restored to its own snapshot.
create or replace function crm_restore_leads(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_row jsonb;
  v_n int := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    update crm_leads l
       set status = coalesce(v_row->>'status', l.status),
           assigned_to = nullif(v_row->>'assigned_to', '')::uuid,
           is_hot = coalesce((v_row->>'is_hot')::boolean, l.is_hot),
           follow_up_at = nullif(v_row->>'follow_up_at', '')::timestamptz,
           is_archived = coalesce((v_row->>'is_archived')::boolean, l.is_archived)
     where l.id = (v_row->>'id')::uuid and l.company_id = v_company;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function crm_restore_leads(jsonb) from public, anon;
grant execute on function crm_restore_leads(jsonb) to authenticated;

-- ── reports over a date range ─────────────────────────────────
create or replace function crm_stats(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_from timestamptz := p_from::timestamptz;
  v_to   timestamptz := (p_to + 1)::timestamptz;   -- inclusive end
  v_created int; v_won int; v_lost int;
  r jsonb;
begin
  if v_company is null then return '{}'::jsonb; end if;
  if p_to < p_from then
    raise exception 'range end before start' using errcode = '22023';
  end if;
  select count(*) into v_created from crm_leads
    where company_id = v_company and is_archived = false and created_at >= v_from and created_at < v_to;
  select count(*) into v_won from crm_leads
    where company_id = v_company and status = 'converted' and converted_at >= v_from and converted_at < v_to;
  select count(*) into v_lost from crm_leads
    where company_id = v_company and status = 'lost' and is_archived = false and stage_changed_at >= v_from and stage_changed_at < v_to;

  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', (select count(*) from crm_leads where company_id = v_company and is_archived = false),
    'overdue', (select count(*) from crm_leads where company_id = v_company and is_archived = false
                  and status not in ('converted','lost') and follow_up_at is not null and follow_up_at < now()),
    'uncontacted', (select count(*) from crm_leads where company_id = v_company and status = 'new'
                      and last_contacted_at is null and is_archived = false),
    'created', v_created,
    'won', v_won,
    'lost', v_lost,
    'conversion_rate', case when v_created = 0 then 0 else round(v_won::numeric / v_created, 4) end,
    'byStatus', (select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
                   from (select status, count(*)::int cnt from crm_leads
                          where company_id = v_company and is_archived = false group by status) s),
    'bySource', (select coalesce(jsonb_object_agg(source, cnt), '{}'::jsonb)
                   from (select source, count(*)::int cnt from crm_leads
                          where company_id = v_company and is_archived = false
                            and created_at >= v_from and created_at < v_to group by source) s)
  ) into r;
  return r;
end;
$$;
revoke all on function crm_stats(date, date) from public, anon;
grant execute on function crm_stats(date, date) to authenticated;

-- ── the team view: what each person is carrying ───────────────
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
  )
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

-- ══════════════════════════════════════════════════════════════
-- CRM automations
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_automation_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 80),
  trigger      text not null check (trigger in ('lead_created', 'stage_changed', 'follow_up_overdue')),
  -- {source?, to_status?, from_status?, is_hot?} — every key present must match.
  condition    jsonb not null default '{}'::jsonb,
  action       text not null check (action in ('assign_to', 'set_follow_up_days', 'mark_hot', 'add_note', 'notify_assignee')),
  -- {user_id} | {days} | {note} | {}
  action_value jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists crm_automation_rules_company_idx on crm_automation_rules (company_id, is_active, trigger);
drop trigger if exists crm_automation_rules_set_updated_at on crm_automation_rules;
create trigger crm_automation_rules_set_updated_at before update on crm_automation_rules
  for each row execute function set_updated_at();

alter table crm_automation_rules enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_automation_rules_select') then
    create policy crm_automation_rules_select on crm_automation_rules
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_automation_rules_write') then
    create policy crm_automation_rules_write on crm_automation_rules
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- One application per rule per lead per day for the overdue trigger, so the
-- hourly cron does not pile the same note on a lead twelve times.
create table if not exists crm_automation_runs (
  rule_id  uuid not null references crm_automation_rules (id) on delete cascade,
  lead_id  uuid not null references crm_leads (id) on delete cascade,
  run_day  date not null default current_date,
  primary key (rule_id, lead_id, run_day)
);
alter table crm_automation_runs enable row level security;

-- Whether a rule's condition holds for a lead in a given transition.
create or replace function crm_rule_matches(p_cond jsonb, p_lead crm_leads, p_from_status text)
returns boolean
language sql
immutable
as $$
  select (p_cond->>'source' is null or p_cond->>'source' = p_lead.source)
     and (p_cond->>'to_status' is null or p_cond->>'to_status' = p_lead.status)
     and (p_cond->>'from_status' is null or p_cond->>'from_status' = p_from_status)
     and (p_cond->>'is_hot' is null or (p_cond->>'is_hot')::boolean = p_lead.is_hot)
$$;

-- Apply every active rule for a trigger to one lead. Runs as definer: it is
-- called from triggers (as the caller) and from cron (as service_role).
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
    end if;

    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_lead.company_id, v_lead.id, null, null, null, 'automation: ' || v_rule.name);
    v_applied := v_applied + 1;
  end loop;
  return v_applied;
end;
$$;
revoke all on function crm_apply_automations(uuid, text, text) from public, anon;
grant execute on function crm_apply_automations(uuid, text, text) to authenticated, service_role;

-- Fire rules from the row triggers. Depth-guarded: an action's own UPDATE
-- must not re-enter and evaluate the rules a second time.
create or replace function crm_leads_automations_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'INSERT' then
    perform crm_apply_automations(new.id, 'lead_created', null);
  elsif new.status is distinct from old.status then
    perform crm_apply_automations(new.id, 'stage_changed', old.status);
  end if;
  return null;
end;
$$;
drop trigger if exists crm_leads_automations on crm_leads;
create trigger crm_leads_automations after insert or update of status on crm_leads
  for each row execute function crm_leads_automations_trigger();

-- ── the follow-up sweep, on the hourly tick ───────────────────
-- Overdue promises become a notification for whoever owns the lead (deduped
-- per day) and run the 'follow_up_overdue' rules.
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
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

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

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified, 'rules_applied', v_rules, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_crm_followup_cron(boolean) from public, anon;
grant execute on function run_crm_followup_cron(boolean) to service_role;

-- ══════════════════════════════════════════════════════════════
-- Attendance: manual correction
-- ══════════════════════════════════════════════════════════════
alter table attendance
  add column if not exists corrected_by    uuid references auth.users (id) on delete set null,
  add column if not exists correction_note text;

create or replace function set_attendance_manual(
  p_user_id      uuid,
  p_date         date,
  p_status       text,
  p_check_in_at  timestamptz default null,
  p_check_out_at timestamptz default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not (is_current_owner() or current_app_role() = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('present', 'late', 'absent') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_check_in_at is not null and p_check_out_at is not null and p_check_out_at < p_check_in_at then
    raise exception 'check-out before check-in' using errcode = '22023';
  end if;
  if not exists (select 1 from users where user_id = p_user_id and company_id = v_company and deleted_at is null) then
    raise exception 'unknown_member' using errcode = 'P0001';
  end if;

  insert into attendance (company_id, user_id, a_date, status, check_in_at, check_out_at, corrected_by, correction_note)
  values (v_company, p_user_id, p_date, p_status, p_check_in_at, p_check_out_at, auth.uid(), p_note)
  on conflict (company_id, user_id, a_date) do update
    set status = excluded.status,
        check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at,
        corrected_by = excluded.corrected_by,
        correction_note = excluded.correction_note
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function set_attendance_manual(uuid, date, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function set_attendance_manual(uuid, date, text, timestamptz, timestamptz, text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- Stage timestamps belong to the row, not to whichever caller moved it
-- ══════════════════════════════════════════════════════════════
-- The API stamped converted_at / last_contacted_at on its own PATCH path, but
-- a bulk edit, an automation or a hand-run UPDATE moved the stage without
-- them — and "won this month" silently missed the sale. The trigger that
-- already writes the event is the one place every stage change passes.
create or replace function log_crm_lead_event()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (new.company_id, new.id, old.status, new.status, auth.uid(), null);
    new.stage_changed_at = now();
    if new.status <> 'new' and new.last_contacted_at is null then
      new.last_contacted_at = now();
    end if;
    if new.status = 'converted' then
      new.converted_at = coalesce(new.converted_at, now());
    elsif old.status = 'converted' then
      new.converted_at = null;
    end if;
  end if;
  if new.is_archived and old.is_archived = false then
    new.archived_at = now();
  elsif not new.is_archived and old.is_archived then
    new.archived_at = null;
  end if;
  return new;
end;
$$;
