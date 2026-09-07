-- 0038: CRM objects — pipelines with stages, contacts, companies, lost
-- reasons — and the loose ends 0037 left: bulk edits that can lose a lead,
-- a phone edit that re-normalises, shared views that do not collide, a
-- forecast anyone can call, and the SLA breach sweep the index was built for.
--
-- The deal record stays crm_leads. It already carries value, probability,
-- follow-up, owner, cadence, events, automations and conversion; copying it
-- into a new table would only move forty endpoints. What changes:
--
--   pipeline_id / stage_id   where the deal is, per studio, per pipeline.
--   status                   DERIVED from the stage's kind (open / won / lost)
--                            by trigger, so every report, filter, cadence and
--                            automation keyed on status keeps working.
--   contact_id               the person — one row per number per studio,
--                            backfilled from the leads that exist.
--   crm_company_id           the organisation, when there is one.
--
-- Additive: no table is renamed; crm_bulk_patch and crm_forecast change their
-- return shape and are dropped and recreated.

-- ══════════════════════════════════════════════════════════════
-- 1. Pipelines and stages
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_pipelines (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 80),
  is_default boolean not null default false,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create unique index if not exists crm_pipelines_default_idx on crm_pipelines (company_id) where is_default;
drop trigger if exists crm_pipelines_set_updated_at on crm_pipelines;
create trigger crm_pipelines_set_updated_at before update on crm_pipelines
  for each row execute function set_updated_at();

create table if not exists crm_pipeline_stages (
  id                  uuid primary key default gen_random_uuid(),
  pipeline_id         uuid not null references crm_pipelines (id) on delete cascade,
  company_id          uuid not null references companies (id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 60),
  -- A stable handle; the six legacy statuses keep their keys so old rules match.
  key                 text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  position            int not null default 0,
  kind                text not null default 'open' check (kind in ('open', 'won', 'lost')),
  probability_default smallint not null default 10 check (probability_default between 0 and 100),
  -- Null = no limit. Counts open, unarchived deals in the stage.
  wip_limit           int check (wip_limit is null or wip_limit between 1 and 1000),
  -- Fields a deal must carry before it may enter this stage.
  required_fields     text[] not null default '{}'::text[]
                      check (required_fields <@ array['deal_value','close_date','email','name','assigned_to','title','lost_reason']::text[]),
  created_at          timestamptz not null default now(),
  unique (pipeline_id, key)
);
create index if not exists crm_pipeline_stages_pipeline_idx on crm_pipeline_stages (pipeline_id, position);

-- ══════════════════════════════════════════════════════════════
-- 2. Companies and contacts
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_companies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 160),
  domain      text check (domain is null or char_length(domain) <= 200),
  phone       text check (phone is null or char_length(phone) <= 30),
  city        text check (city is null or char_length(city) <= 120),
  notes       text check (notes is null or char_length(notes) <= 4000),
  owner_id    uuid references users (user_id) on delete set null,
  is_archived boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists crm_companies_name_idx on crm_companies (company_id, lower(name));
drop trigger if exists crm_companies_set_updated_at on crm_companies;
create trigger crm_companies_set_updated_at before update on crm_companies
  for each row execute function set_updated_at();

create table if not exists crm_contacts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  crm_company_id uuid references crm_companies (id) on delete set null,
  name           text check (name is null or char_length(name) <= 160),
  phone          text check (phone is null or char_length(phone) <= 30),
  phone_norm     text,
  email          text check (email is null or char_length(email) <= 200),
  lifecycle      text not null default 'lead' check (lifecycle in ('lead', 'mql', 'sql', 'customer', 'other')),
  owner_id       uuid references users (user_id) on delete set null,
  source         text,
  notes          text check (notes is null or char_length(notes) <= 4000),
  is_archived    boolean not null default false,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- One person per number per studio: the dedupe key the leads already used.
create unique index if not exists crm_contacts_phone_idx on crm_contacts (company_id, phone_norm) where phone_norm is not null;
create index if not exists crm_contacts_company_idx on crm_contacts (company_id, is_archived, created_at desc);
create index if not exists crm_contacts_crm_company_idx on crm_contacts (crm_company_id) where crm_company_id is not null;
drop trigger if exists crm_contacts_set_updated_at on crm_contacts;
create trigger crm_contacts_set_updated_at before update on crm_contacts
  for each row execute function set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- 3. Lost reasons: a picklist, so "lost" can be reported on
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_lost_reasons (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  label      text not null check (char_length(label) between 3 and 80),
  position   int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, label)
);

-- ══════════════════════════════════════════════════════════════
-- 4. RLS for the new tables
-- ══════════════════════════════════════════════════════════════
alter table crm_pipelines       enable row level security;
alter table crm_pipeline_stages enable row level security;
alter table crm_companies       enable row level security;
alter table crm_contacts        enable row level security;
alter table crm_lost_reasons    enable row level security;
do $$
declare t text;
begin
  foreach t in array array['crm_pipelines', 'crm_pipeline_stages', 'crm_companies', 'crm_contacts', 'crm_lost_reasons'] loop
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

-- 0035 enabled RLS on crm_automation_runs with no policy: readable by nobody,
-- so the Automations tab could never say when a rule last fired.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_automation_runs_select') then
    create policy crm_automation_runs_select on crm_automation_runs
      for select to authenticated
      using (exists (select 1 from crm_automation_rules r where r.id = rule_id and r.company_id = get_current_company_id()));
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 5. Every studio has a default pipeline and a lost-reason list
-- ══════════════════════════════════════════════════════════════
create or replace function crm_ensure_default_pipeline(p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipeline uuid;
begin
  select id into v_pipeline from crm_pipelines where company_id = p_company and is_default;
  if v_pipeline is null then
    insert into crm_pipelines (company_id, name, is_default) values (p_company, 'Sales', true)
    on conflict (company_id, name) do update set is_default = true
    returning id into v_pipeline;
    insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind, probability_default) values
      (v_pipeline, p_company, 'New',           'new',           0, 'open', 10),
      (v_pipeline, p_company, 'Contacted',     'contacted',     1, 'open', 25),
      (v_pipeline, p_company, 'Qualified',     'qualified',     2, 'open', 50),
      (v_pipeline, p_company, 'Proposal sent', 'proposal_sent', 3, 'open', 75),
      (v_pipeline, p_company, 'Won',           'converted',     4, 'won',  100),
      (v_pipeline, p_company, 'Lost',          'lost',          5, 'lost', 0)
    on conflict (pipeline_id, key) do nothing;
  end if;
  if not exists (select 1 from crm_lost_reasons where company_id = p_company) then
    insert into crm_lost_reasons (company_id, label, position) values
      (p_company, 'Budget', 0), (p_company, 'Timing', 1), (p_company, 'Went elsewhere', 2),
      (p_company, 'No response', 3), (p_company, 'Other', 4)
    on conflict do nothing;
  end if;
  return v_pipeline;
end;
$$;
revoke all on function crm_ensure_default_pipeline(uuid) from public, anon, authenticated;

create or replace function companies_seed_crm_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform crm_ensure_default_pipeline(new.id);
  return null;
end;
$$;
drop trigger if exists companies_seed_crm on companies;
create trigger companies_seed_crm after insert on companies
  for each row execute function companies_seed_crm_trigger();

do $$
declare c uuid;
begin
  for c in select id from companies loop
    perform crm_ensure_default_pipeline(c);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 6. The deal columns on crm_leads
-- ══════════════════════════════════════════════════════════════
alter table crm_leads
  add column if not exists contact_id      uuid references crm_contacts (id) on delete set null,
  add column if not exists crm_company_id  uuid references crm_companies (id) on delete set null,
  add column if not exists pipeline_id     uuid references crm_pipelines (id) on delete set null,
  add column if not exists stage_id        uuid references crm_pipeline_stages (id) on delete set null,
  add column if not exists close_date      date,
  add column if not exists currency        text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  add column if not exists title           text check (title is null or char_length(title) <= 160),
  add column if not exists lost_competitor text check (lost_competitor is null or char_length(lost_competitor) <= 120),
  add column if not exists score           int not null default 0;
create index if not exists crm_leads_stage_idx on crm_leads (company_id, stage_id) where is_archived = false;
create index if not exists crm_leads_contact_idx on crm_leads (contact_id) where contact_id is not null;
create index if not exists crm_leads_crm_company_idx on crm_leads (crm_company_id) where crm_company_id is not null;
create index if not exists crm_leads_close_idx on crm_leads (company_id, close_date) where close_date is not null;

-- ── stage ↔ status ────────────────────────────────────────────
-- The legacy status for a stage: won → converted, lost → lost, and an open
-- stage maps by its key when it is one of the four legacy keys, otherwise by
-- its rank among the pipeline's open stages (so a custom fifth open stage
-- still counts as "proposal_sent" for every old report).
create or replace function crm_stage_status(p_stage uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stage crm_pipeline_stages;
  v_rank int;
  v_legacy text[] := array['new', 'contacted', 'qualified', 'proposal_sent'];
begin
  select * into v_stage from crm_pipeline_stages where id = p_stage;
  if not found then return null; end if;
  if v_stage.kind = 'won' then return 'converted'; end if;
  if v_stage.kind = 'lost' then return 'lost'; end if;
  if v_stage.key = any(v_legacy) then return v_stage.key; end if;
  select count(*) into v_rank from crm_pipeline_stages s
   where s.pipeline_id = v_stage.pipeline_id and s.kind = 'open'
     and (s.position < v_stage.position or (s.position = v_stage.position and s.created_at < v_stage.created_at));
  return v_legacy[least(v_rank, 3) + 1];
end;
$$;
-- Definer, so it reads stages regardless of RLS: keep it off the public role.
revoke all on function crm_stage_status(uuid) from public, anon;
grant execute on function crm_stage_status(uuid) to authenticated;

-- The stage a legacy status lands in: the stage with that key, else the
-- pipeline's won/lost stage, else the open stage at the same rank.
create or replace function crm_stage_for_status(p_pipeline uuid, p_status text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid;
  v_rank int := array_position(array['new', 'contacted', 'qualified', 'proposal_sent'], p_status);
begin
  if p_pipeline is null then return null; end if;
  select id into v from crm_pipeline_stages where pipeline_id = p_pipeline and key = p_status limit 1;
  if v is not null then return v; end if;
  if p_status = 'converted' then
    select id into v from crm_pipeline_stages where pipeline_id = p_pipeline and kind = 'won' order by position limit 1;
  elsif p_status = 'lost' then
    select id into v from crm_pipeline_stages where pipeline_id = p_pipeline and kind = 'lost' order by position limit 1;
  end if;
  if v is not null then return v; end if;
  select id into v from crm_pipeline_stages where pipeline_id = p_pipeline and kind = 'open'
   order by position, created_at offset greatest(coalesce(v_rank, 1) - 1, 0) limit 1;
  if v is null then
    select id into v from crm_pipeline_stages where pipeline_id = p_pipeline and kind = 'open' order by position desc limit 1;
  end if;
  return v;
end;
$$;
-- Deleting a pipeline re-homes its deals through this as the caller, so
-- `authenticated` keeps it; nobody else needs it.
revoke all on function crm_stage_for_status(uuid, text) from public, anon;
grant execute on function crm_stage_for_status(uuid, text) to authenticated;

-- The contact a deal belongs to: the studio's row for that number, created
-- when there is none. A deal without a number gets a contact of its own.
create or replace function crm_link_contact(
  p_company uuid, p_current uuid, p_name text, p_phone text, p_phone_norm text, p_email text, p_owner uuid, p_source text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
begin
  if p_phone_norm is not null then
    select id into v from crm_contacts where company_id = p_company and phone_norm = p_phone_norm;
    if v is not null then
      update crm_contacts
         set name = coalesce(name, p_name), email = coalesce(email, p_email), owner_id = coalesce(owner_id, p_owner)
       where id = v and (name is null or email is null or owner_id is null);
      return v;
    end if;
  elsif p_current is not null then
    return p_current;
  end if;
  insert into crm_contacts (company_id, name, phone, phone_norm, email, owner_id, source, created_by)
  values (p_company, p_name, p_phone, p_phone_norm, p_email, p_owner, p_source, auth.uid())
  returning id into v;
  return v;
end;
$$;
-- It takes the company as an argument and writes with it, so it must never be
-- callable directly: crm_leads_sync() is the only caller, and runs as definer.
revoke all on function crm_link_contact(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- The one trigger that keeps a deal consistent. It runs first (its name sorts
-- before every other crm_leads trigger) so the event log, the automations
-- and the cadence stop all see the derived status.
create or replace function crm_leads_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage crm_pipeline_stages;
begin
  -- 0037 recomputed nothing when a number was edited, so a corrected phone
  -- kept the old dedupe key. Every insert and every phone change re-derives it.
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    new.phone_norm := crm_normalize_phone(new.phone);
  end if;

  if new.pipeline_id is null then
    select id into new.pipeline_id from crm_pipelines where company_id = new.company_id and is_default;
    if new.pipeline_id is null then new.pipeline_id := crm_ensure_default_pipeline(new.company_id); end if;
  end if;

  if tg_op = 'INSERT' then
    if new.stage_id is null then
      new.stage_id := crm_stage_for_status(new.pipeline_id, new.status);
    else
      new.status := crm_stage_status(new.stage_id);
    end if;
  elsif new.stage_id is distinct from old.stage_id and new.stage_id is not null then
    new.status := crm_stage_status(new.stage_id);
    select pipeline_id into new.pipeline_id from crm_pipeline_stages where id = new.stage_id;
  elsif new.status is distinct from old.status or new.pipeline_id is distinct from old.pipeline_id then
    new.stage_id := coalesce(crm_stage_for_status(new.pipeline_id, new.status), new.stage_id);
  end if;

  -- Lost carries a reason; anything else carries none.
  if new.status = 'lost' then
    if new.lost_reason is null or char_length(trim(new.lost_reason)) < 3 then
      raise exception 'lost_reason required (3-500 chars) when status=lost' using errcode = '22023';
    end if;
  else
    new.lost_reason := null;
    new.lost_competitor := null;
  end if;

  -- Probability follows the stage unless someone set it by hand.
  if new.probability is null
     or (tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id and new.probability is not distinct from old.probability) then
    select * into v_stage from crm_pipeline_stages where id = new.stage_id;
    new.probability := coalesce(v_stage.probability_default,
      case new.status when 'new' then 10 when 'contacted' then 25 when 'qualified' then 50
                      when 'proposal_sent' then 75 when 'converted' then 100 else 0 end);
  end if;

  if new.contact_id is null
     or (tg_op = 'UPDATE' and new.phone_norm is distinct from old.phone_norm and new.phone_norm is not null) then
    new.contact_id := crm_link_contact(new.company_id, new.contact_id, new.name, new.phone, new.phone_norm, new.email, new.assigned_to, new.source);
  end if;
  if new.crm_company_id is null and new.contact_id is not null then
    select crm_company_id into new.crm_company_id from crm_contacts where id = new.contact_id;
  end if;
  -- A won deal makes its contact a customer.
  if new.status = 'converted' and (tg_op = 'INSERT' or old.status is distinct from 'converted') and new.contact_id is not null then
    update crm_contacts set lifecycle = 'customer' where id = new.contact_id and lifecycle <> 'customer';
  end if;
  return new;
end;
$$;

-- ── backfill before the trigger is armed ──────────────────────
alter table crm_leads disable trigger crm_leads_set_updated_at;
do $$
declare
  r record;
  v_contact uuid;
begin
  update crm_leads l
     set pipeline_id = p.id
    from crm_pipelines p
   where p.company_id = l.company_id and p.is_default and l.pipeline_id is null;
  update crm_leads l
     set stage_id = crm_stage_for_status(l.pipeline_id, l.status)
   where l.stage_id is null and l.pipeline_id is not null;

  -- One contact per number, from the newest lead that carries it.
  insert into crm_contacts (company_id, name, phone, phone_norm, email, owner_id, source, lifecycle, created_at)
  select distinct on (l.company_id, l.phone_norm)
         l.company_id, l.name, l.phone, l.phone_norm, l.email, l.assigned_to, l.source,
         case when exists (select 1 from crm_leads w where w.company_id = l.company_id and w.phone_norm = l.phone_norm and w.status = 'converted')
              then 'customer' else 'lead' end,
         (select min(f.created_at) from crm_leads f where f.company_id = l.company_id and f.phone_norm = l.phone_norm)
    from crm_leads l
   where l.phone_norm is not null and l.contact_id is null
   order by l.company_id, l.phone_norm, l.created_at desc
  on conflict do nothing;
  update crm_leads l
     set contact_id = c.id
    from crm_contacts c
   where c.company_id = l.company_id and c.phone_norm = l.phone_norm
     and l.contact_id is null and l.phone_norm is not null;

  for r in select id, company_id, name, phone, email, assigned_to, source, created_at from crm_leads where contact_id is null loop
    insert into crm_contacts (company_id, name, phone, phone_norm, email, owner_id, source, created_at)
    values (r.company_id, r.name, r.phone, null, r.email, r.assigned_to, r.source, r.created_at)
    returning id into v_contact;
    update crm_leads set contact_id = v_contact where id = r.id;
  end loop;
end $$;
alter table crm_leads enable trigger crm_leads_set_updated_at;

-- 0037's enforce_lost_reason_trg only fired for UPDATE OF status, lost_reason,
-- probability — a stage move that derives 'lost' never reached it. The sync
-- trigger enforces the same rule on every write, so the old one goes.
drop trigger if exists enforce_lost_reason_trg on crm_leads;
drop trigger if exists crm_leads_a_sync on crm_leads;
create trigger crm_leads_a_sync before insert or update on crm_leads
  for each row execute function crm_leads_sync();

-- The same column-list problem: 0035/0036 armed these for UPDATE OF status,
-- which a stage_id write never names. Both functions already test whether
-- status actually changed, so they simply fire on every update now.
drop trigger if exists crm_leads_automations on crm_leads;
create trigger crm_leads_automations after insert or update on crm_leads
  for each row execute function crm_leads_automations_trigger();
drop trigger if exists crm_leads_stop_cadence on crm_leads;
create trigger crm_leads_stop_cadence after update on crm_leads
  for each row execute function crm_leads_stop_cadence_trigger();

-- Contacts normalise their own number too.
create or replace function crm_contacts_sync()
returns trigger
language plpgsql
as $$
begin
  new.phone_norm := crm_normalize_phone(new.phone);
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists crm_contacts_a_sync on crm_contacts;
create trigger crm_contacts_a_sync before insert or update of phone on crm_contacts
  for each row execute function crm_contacts_sync();

-- ══════════════════════════════════════════════════════════════
-- 7. Moving a deal: the checks a stage can demand
-- ══════════════════════════════════════════════════════════════
create or replace function crm_move_stage(p_lead uuid, p_stage uuid, p_lost_reason text default null, p_competitor text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_lead    crm_leads;
  v_stage   crm_pipeline_stages;
  v_contact crm_contacts;
  v_field   text;
  v_open    int;
  v_missing text[] := '{}';
  v_reason  text := nullif(trim(coalesce(p_lost_reason, '')), '');
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_lead from crm_leads where id = p_lead and company_id = v_company;
  if not found then raise exception 'unknown lead' using errcode = '42501'; end if;
  select * into v_stage from crm_pipeline_stages where id = p_stage and company_id = v_company;
  if not found then raise exception 'unknown stage' using errcode = '42501'; end if;
  if v_stage.pipeline_id is distinct from v_lead.pipeline_id then
    raise exception 'That stage belongs to another pipeline.' using errcode = 'P0001';
  end if;
  if v_stage.id = v_lead.stage_id then return v_lead.status; end if;

  if v_stage.wip_limit is not null then
    select count(*) into v_open from crm_leads
     where stage_id = v_stage.id and is_archived = false and id <> v_lead.id;
    if v_open >= v_stage.wip_limit then
      raise exception '% is full: its limit is % deal%.', v_stage.name, v_stage.wip_limit, case when v_stage.wip_limit = 1 then '' else 's' end
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_contact from crm_contacts where id = v_lead.contact_id;
  foreach v_field in array v_stage.required_fields loop
    if (v_field = 'deal_value' and coalesce(v_lead.deal_value, 0) <= 0)
       or (v_field = 'close_date' and v_lead.close_date is null)
       or (v_field = 'email' and coalesce(v_lead.email, v_contact.email) is null)
       or (v_field = 'name' and coalesce(v_lead.name, v_contact.name) is null)
       or (v_field = 'assigned_to' and v_lead.assigned_to is null)
       or (v_field = 'title' and v_lead.title is null)
       or (v_field = 'lost_reason' and coalesce(v_reason, v_lead.lost_reason) is null) then
      v_missing := v_missing || v_field;
    end if;
  end loop;
  if v_stage.kind = 'lost' and coalesce(v_reason, v_lead.lost_reason) is null and not ('lost_reason' = any(v_missing)) then
    v_missing := v_missing || 'lost_reason';
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Fill in % before moving to %.', array_to_string(v_missing, ', '), v_stage.name using errcode = 'P0001';
  end if;

  update crm_leads
     set stage_id = v_stage.id,
         lost_reason = case when v_stage.kind = 'lost' then coalesce(v_reason, lost_reason) else null end,
         lost_competitor = case when v_stage.kind = 'lost' then coalesce(nullif(trim(coalesce(p_competitor, '')), ''), lost_competitor) else null end
   where id = v_lead.id;
  return (select status from crm_leads where id = v_lead.id);
end;
$$;
revoke all on function crm_move_stage(uuid, uuid, text, text) from public, anon;
grant execute on function crm_move_stage(uuid, uuid, text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 8. Bulk edits carry the deal fields, and can lose a deal
-- ══════════════════════════════════════════════════════════════
drop function if exists crm_bulk_patch(uuid[], jsonb);
create or replace function crm_bulk_patch(p_ids uuid[], p_patch jsonb)
returns table (
  id uuid, status text, assigned_to uuid, is_hot boolean, follow_up_at timestamptz, is_archived boolean,
  deal_value numeric, probability smallint, lost_reason text, lost_competitor text, stage_id uuid, close_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_pipeline uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('new','contacted','qualified','proposal_sent','converted','lost') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_patch ? 'stage_id' then
    select s.pipeline_id into v_pipeline from crm_pipeline_stages s
     where s.id = (p_patch->>'stage_id')::uuid and s.company_id = v_company;
    if v_pipeline is null then
      raise exception 'unknown stage' using errcode = '22023';
    end if;
    -- crm_move_stage() refuses a stage from another pipeline; a bulk edit must
    -- refuse it too, or a deal lands in a pipeline it was never in.
    if exists (
      select 1 from crm_leads l
      where l.id = any(p_ids) and l.company_id = v_company and l.pipeline_id is distinct from v_pipeline
    ) then
      raise exception 'That stage belongs to another pipeline.' using errcode = 'P0001';
    end if;
  end if;

  return query
    select l.id, l.status, l.assigned_to, l.is_hot, l.follow_up_at, l.is_archived,
           l.deal_value, l.probability, l.lost_reason, l.lost_competitor, l.stage_id, l.close_date
    from crm_leads l
    where l.id = any(p_ids) and l.company_id = v_company;

  update crm_leads l
     set status = coalesce(p_patch->>'status', l.status),
         stage_id = case when p_patch ? 'stage_id' then (p_patch->>'stage_id')::uuid else l.stage_id end,
         lost_reason = case when p_patch ? 'lost_reason' then nullif(p_patch->>'lost_reason', '') else l.lost_reason end,
         lost_competitor = case when p_patch ? 'lost_competitor' then nullif(p_patch->>'lost_competitor', '') else l.lost_competitor end,
         assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else l.assigned_to end,
         is_hot = coalesce((p_patch->>'is_hot')::boolean, l.is_hot),
         follow_up_at = case when p_patch ? 'follow_up_at' then nullif(p_patch->>'follow_up_at', '')::timestamptz else l.follow_up_at end,
         is_archived = coalesce((p_patch->>'is_archived')::boolean, l.is_archived),
         deal_value = case when p_patch ? 'deal_value' then nullif(p_patch->>'deal_value', '')::numeric else l.deal_value end,
         probability = case when p_patch ? 'probability' then nullif(p_patch->>'probability', '')::smallint else l.probability end,
         close_date = case when p_patch ? 'close_date' then nullif(p_patch->>'close_date', '')::date else l.close_date end
   where l.id = any(p_ids) and l.company_id = v_company;
end;
$$;
revoke all on function crm_bulk_patch(uuid[], jsonb) from public, anon;
grant execute on function crm_bulk_patch(uuid[], jsonb) to authenticated;

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
       set stage_id = coalesce(nullif(v_row->>'stage_id', '')::uuid, l.stage_id),
           status = coalesce(v_row->>'status', l.status),
           lost_reason = case when v_row ? 'lost_reason' then nullif(v_row->>'lost_reason', '') else l.lost_reason end,
           lost_competitor = case when v_row ? 'lost_competitor' then nullif(v_row->>'lost_competitor', '') else l.lost_competitor end,
           assigned_to = nullif(v_row->>'assigned_to', '')::uuid,
           is_hot = coalesce((v_row->>'is_hot')::boolean, l.is_hot),
           follow_up_at = nullif(v_row->>'follow_up_at', '')::timestamptz,
           is_archived = coalesce((v_row->>'is_archived')::boolean, l.is_archived),
           deal_value = case when v_row ? 'deal_value' then nullif(v_row->>'deal_value', '')::numeric else l.deal_value end,
           probability = case when v_row ? 'probability' then nullif(v_row->>'probability', '')::smallint else l.probability end,
           close_date = case when v_row ? 'close_date' then nullif(v_row->>'close_date', '')::date else l.close_date end
     where l.id = (v_row->>'id')::uuid and l.company_id = v_company;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

-- The pre-0035 overload has had no caller since the ranged one arrived.
drop function if exists crm_stats(int);

-- ══════════════════════════════════════════════════════════════
-- 9. Saved views: the shared ones no longer collide
-- ══════════════════════════════════════════════════════════════
-- 0036's unique (user_id, name) survived 0037's partial indexes, so two
-- people could not each publish a "Hot this week" team view.
alter table crm_saved_views drop constraint if exists crm_saved_views_user_id_name_key;
update crm_saved_views set created_by = user_id where created_by is null;
drop policy if exists crm_saved_views_own on crm_saved_views;
drop policy if exists crm_saved_views_write on crm_saved_views;
-- Anyone active may create; only the creator or the owner may change or remove.
create policy crm_saved_views_write on crm_saved_views
  for all to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_owner()))
  with check (company_id = get_current_company_id() and is_current_user_active());

-- ══════════════════════════════════════════════════════════════
-- 10. Forecast: weighted pipeline by stage, owner and close month
-- ══════════════════════════════════════════════════════════════
drop function if exists crm_forecast(date, date);
create or replace function crm_forecast(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  r jsonb;
begin
  if v_company is null then return '{}'::jsonb; end if;
  if p_to < p_from then raise exception 'range end before start' using errcode = '22023'; end if;
  with d as (
    select l.id, l.deal_value, l.probability, l.status, l.assigned_to, l.stage_id,
           coalesce(l.close_date, l.created_at::date) as close_on,
           s.name as stage_name, s.kind, s.position,
           u.name as owner_name,
           coalesce(l.deal_value, 0) * coalesce(l.probability, 0) / 100.0 as weighted
    from crm_leads l
    left join crm_pipeline_stages s on s.id = l.stage_id
    left join users u on u.user_id = l.assigned_to
    where l.company_id = v_company and l.is_archived = false and l.status <> 'lost'
      and coalesce(l.close_date, l.created_at::date) between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'count', (select count(*) from d),
    'total_value', (select coalesce(sum(deal_value), 0) from d),
    'weighted', (select coalesce(sum(weighted), 0) from d),
    'won_value', (select coalesce(sum(deal_value), 0) from d where status = 'converted'),
    'open_value', (select coalesce(sum(deal_value), 0) from d where status <> 'converted'),
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object(
                   'stage_id', stage_id, 'name', coalesce(stage_name, 'No stage'), 'kind', coalesce(kind, 'open'),
                   'count', n, 'total_value', total, 'weighted', w) order by position nulls last), '[]'::jsonb)
                 from (select stage_id, stage_name, kind, min(position) as position, count(*) as n,
                              coalesce(sum(deal_value), 0) as total, coalesce(sum(weighted), 0) as w
                       from d group by stage_id, stage_name, kind) x),
    'by_owner', (select coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', assigned_to, 'name', coalesce(owner_name, 'Unassigned'),
                   'count', n, 'total_value', total, 'weighted', w) order by w desc), '[]'::jsonb)
                 from (select assigned_to, owner_name, count(*) as n,
                              coalesce(sum(deal_value), 0) as total, coalesce(sum(weighted), 0) as w
                       from d group by assigned_to, owner_name) x),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object(
                   'month', m, 'count', n, 'total_value', total, 'weighted', w) order by m), '[]'::jsonb)
                 from (select to_char(close_on, 'YYYY-MM') as m, count(*) as n,
                              coalesce(sum(deal_value), 0) as total, coalesce(sum(weighted), 0) as w
                       from d group by 1) x)
  ) into r;
  return r;
end;
$$;
revoke all on function crm_forecast(date, date) from public, anon;
grant execute on function crm_forecast(date, date) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 11. The SLA breach sweep 0037 indexed for and never wrote
-- ══════════════════════════════════════════════════════════════
-- A lead past its first-contact target with nobody having reached it: one
-- notification to the owner (or the studio owner when unassigned) per day,
-- and one line in its history the first time.
create or replace function crm_sla_sweep(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_breached int := 0;
  v_notified int := 0;
  v_to uuid;
begin
  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.sla_due_at, c.owner_user_id
    from crm_leads l
    join companies c on c.id = l.company_id
    where l.is_archived = false
      and l.status not in ('converted', 'lost')
      and l.last_contacted_at is null
      and l.sla_due_at is not null
      and l.sla_due_at < now()
  loop
    v_breached := v_breached + 1;
    if p_dry_run then continue; end if;
    v_to := coalesce(v_r.assigned_to, v_r.owner_user_id);
    if create_notification(
         v_r.company_id, v_to, 'crm_sla',
         'SLA breached: ' || coalesce(v_r.name, v_r.phone, 'unnamed lead'),
         'Nobody has reached them since ' || to_char(v_r.sla_due_at, 'DD Mon HH24:MI'),
         'crm_sla:' || v_r.id::text || ':' || current_date::text,
         'crm_lead', v_r.id)
    then
      v_notified := v_notified + 1;
    end if;
    if not exists (select 1 from crm_lead_events e where e.lead_id = v_r.id and e.note = 'SLA breached') then
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.id, null, null, null, 'SLA breached');
    end if;
  end loop;
  return jsonb_build_object('breached', v_breached, 'notified', v_notified);
end;
$$;
revoke all on function crm_sla_sweep(boolean) from public, anon;
grant execute on function crm_sla_sweep(boolean) to service_role;

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
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);
  v_sla := crm_sla_sweep(p_dry_run);

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
                                  'cadences', v_cadences, 'sla', v_sla, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

-- Changing the SLA target moves the deadline on every lead still waiting.
create or replace function crm_set_sla_hours(p_hours int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'sla_hours must be between 1 and 720' using errcode = '22023';
  end if;
  insert into crm_settings (company_id, sla_hours) values (v_company, p_hours)
  on conflict (company_id) do update set sla_hours = excluded.sla_hours;
  update crm_leads
     set sla_due_at = created_at + make_interval(hours => p_hours)
   where company_id = v_company and is_archived = false
     and status not in ('converted', 'lost') and last_contacted_at is null;
  return p_hours;
end;
$$;
revoke all on function crm_set_sla_hours(int) from public, anon;
grant execute on function crm_set_sla_hours(int) to authenticated;
