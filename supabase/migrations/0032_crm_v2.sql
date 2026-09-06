-- Phase 32: CRM v2 — events, archive, templates, duplicate helpers.
-- Nothing here renames an existing object; all additions are additive and RLS-scoped.

-- ── archive / soft-hide for bulk work ───────────────────────────
alter table crm_leads
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists stage_changed_at timestamptz;

-- Keep phone_norm dedupe fast across 10k+ rows in a single tenant.
create index if not exists crm_leads_archived_idx on crm_leads (company_id) where is_archived = false;
create index if not exists crm_leads_phone_norm_active_idx on crm_leads (company_id, phone_norm) where is_archived = false;

-- Backfill stage_changed_at for ordering stability.
update crm_leads set stage_changed_at = updated_at where stage_changed_at is null;

-- ── event trail for every status/patch ──────────────────────────
create table if not exists crm_lead_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  lead_id    uuid not null references crm_leads (id) on delete cascade,
  from_status text,
  to_status   text,
  actor_id   uuid references auth.users (id) on delete set null,
  note       text,
  created_at timestamptz not null default now()
);
create index crm_lead_events_lead_idx on crm_lead_events (lead_id, created_at desc);
create index crm_lead_events_company_idx on crm_lead_events (company_id, created_at desc);

alter table crm_lead_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_lead_events_select') then
    create policy crm_lead_events_select on crm_lead_events for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_lead_events_write') then
    create policy crm_lead_events_write on crm_lead_events for all to authenticated using (company_id = get_current_company_id() and is_current_user_active()) with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- Stamp an event whenever status changes. RLS writes are app-side too; this trigger guarantees the trail.
create or replace function log_crm_lead_event()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (new.company_id, new.id, old.status, new.status, auth.uid(), null);
    new.stage_changed_at = now();
  end if;
  if new.is_archived and old.is_archived = false then
    new.archived_at = now();
  elsif not new.is_archived and old.is_archived then
    new.archived_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_log_event on crm_leads;
create trigger crm_leads_log_event before update on crm_leads for each row execute function log_crm_lead_event();

-- ── templates library ───────────────────────────────────────────
create table if not exists crm_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 80),
  body       text not null check (char_length(body) between 2 and 2000),
  kind       text not null default 'whatsapp' check (kind in ('whatsapp','email','note')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger crm_templates_set_updated_at before update on crm_templates for each row execute function set_updated_at();
create index crm_templates_company_idx on crm_templates (company_id, created_at desc);

alter table crm_templates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_templates_select') then
    create policy crm_templates_select on crm_templates for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_templates_write') then
    create policy crm_templates_write on crm_templates for all to authenticated using (company_id = get_current_company_id() and is_current_user_active()) with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- ── duplicate helper (shared phone_norm groups) ─────────────────
create or replace function crm_duplicate_groups()
returns table (phone_norm text, lead_ids uuid[], lead_count int)
language sql
security definer
set search_path = public
as $$
  select phone_norm, array_agg(id order by created_at), count(*)::int
  from crm_leads
  where company_id = get_current_company_id()
    and phone_norm is not null
    and is_archived = false
  group by phone_norm
  having count(*) > 1
  order by count(*) desc
  limit 50;
$$;
revoke all on function crm_duplicate_groups() from public, anon;
grant execute on function crm_duplicate_groups() to authenticated;

-- ── merge: archive duplicates into survivor, carry notes ────────
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
    select notes into v_notes from crm_leads where id = v_id and company_id = v_company;
    if v_notes is not null and char_length(trim(v_notes)) > 0 then
      update crm_leads set notes = coalesce(notes,'') || chr(10) || '[merged from ' || v_id::text || '] ' || v_notes where id = p_survivor;
    end if;
    -- keep the phone_norm but archive so dedupe no longer collides
    update crm_leads set is_archived = true, archived_at = now(), status = 'lost' where id = v_id and company_id = v_company;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_survivor, null, null, auth.uid(), 'merged duplicate ' || v_id::text);
    v_merged := v_merged + 1;
  end loop;
  return v_merged;
end;
$$;
revoke all on function merge_leads(uuid, uuid[]) from public, anon;
grant execute on function merge_leads(uuid, uuid[]) to authenticated;

-- ── stats helper for reports ─────────────────────────────────────
create or replace function crm_stats(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := get_current_company_id(); r jsonb;
begin
  if v_company is null then return '{}'::jsonb; end if;
  select jsonb_build_object(
    'total', (select count(*) from crm_leads where company_id=v_company and is_archived=false),
    'overdue', (select count(*) from crm_leads where company_id=v_company and is_archived=false and status not in ('converted','lost') and follow_up_at is not null and follow_up_at::date < current_date),
    'uncontacted', (select count(*) from crm_leads where company_id=v_company and status='new' and last_contacted_at is null and is_archived=false),
    'wonThisMonth', (select count(*) from crm_leads where company_id=v_company and status='converted' and converted_at >= date_trunc('month', now())),
    'byStatus', (select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (select status, count(*)::int cnt from crm_leads where company_id=v_company and is_archived=false group by status) s),
    'bySource', (select coalesce(jsonb_object_agg(source, cnt), '{}'::jsonb) from (select source, count(*)::int cnt from crm_leads where company_id=v_company and is_archived=false group by source) s)
  ) into r;
  return r;
end;
$$;
revoke all on function crm_stats(int) from public, anon;
grant execute on function crm_stats(int) to authenticated;
