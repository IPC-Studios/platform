-- 0099: Lovable CRM depth parity — lead quality/contacted, template/cadence/
-- source/distribution parity columns. All additive, idempotent.
--
-- Lovable's crm lead carries quality (hot/warm/cold) + contacted_status
-- (uncontacted/contacted/unreachable) as first-class fields; this codebase
-- only had is_hot + last_contacted_at. Both live beside the existing
-- columns (triggers/backfills keep them consistent) so reports, filters,
-- automations and the API can speak Lovable's language without breaking
-- anything that reads is_hot today.

-- ── leads: quality + contacted_status ───────────────────────────
alter table crm_leads
  add column if not exists quality text
    check (quality is null or quality in ('hot', 'warm', 'cold')),
  add column if not exists contacted_status text not null default 'uncontacted'
    check (contacted_status in ('uncontacted', 'contacted', 'unreachable'));

create index if not exists crm_leads_quality_idx
  on crm_leads (company_id, quality) where is_archived = false;
create index if not exists crm_leads_contacted_idx
  on crm_leads (company_id, contacted_status) where is_archived = false;

-- Backfill once: hot flag -> quality, contact stamp -> contacted_status.
update crm_leads set quality = 'hot'
 where quality is null and is_hot = true;
update crm_leads set contacted_status = 'contacted'
 where contacted_status = 'uncontacted'
   and (last_contacted_at is not null or status <> 'new');

-- Keep the pairs consistent on every write: quality hot <=> is_hot, and
-- leaving 'new'/stamping contact moves contacted_status forward (never
-- backwards — an explicit 'unreachable' survives a later edit).
create or replace function crm_leads_quality_sync()
returns trigger
language plpgsql
as $$
begin
  if new.quality = 'hot' and new.is_hot = false then
    new.is_hot := true;
  elsif new.is_hot = true and new.quality is null then
    new.quality := 'hot';
  end if;
  if tg_op = 'INSERT' then
    if new.last_contacted_at is not null or new.status <> 'new' then
      if new.contacted_status = 'uncontacted' then new.contacted_status := 'contacted'; end if;
    end if;
  elsif new.last_contacted_at is distinct from old.last_contacted_at
     or new.status is distinct from old.status then
    if (new.last_contacted_at is not null or new.status <> 'new')
       and new.contacted_status = 'uncontacted' then
      new.contacted_status := 'contacted';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_leads_quality_sync_trg on crm_leads;
create trigger crm_leads_quality_sync_trg before insert or update on crm_leads
  for each row execute function crm_leads_quality_sync();

-- ── templates: category / usage / active ────────────────────────
alter table crm_templates
  add column if not exists category text check (category is null or char_length(category) <= 80),
  add column if not exists usage_count int not null default 0 check (usage_count >= 0),
  add column if not exists is_active boolean not null default true;

create index if not exists crm_templates_active_idx
  on crm_templates (company_id, is_active, created_at desc);

-- Sending a template counts as usage (Lovable's usage_count display).
create or replace function crm_templates_bump_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update crm_templates set usage_count = usage_count + 1 where id = new.template_id;
  return null;
end;
$$;
drop trigger if exists crm_outbox_bump_usage on crm_outbox;
create trigger crm_outbox_bump_usage after insert on crm_outbox
  for each row execute function crm_templates_bump_usage();

-- ── cadences: stage/source preset + per-step routing ────────────
alter table crm_cadences
  add column if not exists description text check (description is null or char_length(description) <= 500),
  add column if not exists stage_filter text,
  add column if not exists source_filter text;

alter table crm_cadence_steps
  add column if not exists recommended_delay_days int check (recommended_delay_days is null or (recommended_delay_days between 0 and 365)),
  add column if not exists next_stage text,
  add column if not exists next_follow_up_days int check (next_follow_up_days is null or (next_follow_up_days between 0 and 365));

-- ── webhook sources: kinds, origins, defaults, last receipt ─────
alter table crm_webhook_sources
  add column if not exists source_type text not null default 'webhook'
    check (source_type in ('website_form', 'google_form', 'elementor', 'landing_page', 'webhook', 'other')),
  add column if not exists allowed_origin text check (allowed_origin is null or char_length(allowed_origin) <= 200),
  add column if not exists default_source text check (default_source is null or char_length(default_source) <= 40),
  add column if not exists default_stage text check (default_stage is null or char_length(default_stage) <= 40),
  add column if not exists default_quality text check (default_quality is null or default_quality in ('hot', 'warm', 'cold')),
  add column if not exists default_assigned_to uuid references users (user_id) on delete set null,
  add column if not exists last_received_at timestamptz;

-- Existing rows: map legacy kind -> source_type so the Test Center labels them.
update crm_webhook_sources set source_type = case kind when 'meta' then 'webhook' else 'website_form' end
 where source_type = 'webhook' and kind in ('webform', 'meta');

-- capture_lead stamps last_received_at on the source it arrived through.
create or replace function crm_sources_touch(p_source_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update crm_webhook_sources set last_received_at = now() where source_key = p_source_key;
$$;
revoke all on function crm_sources_touch(text) from public, anon;

-- ── distribution rota: named rules, source filter, strategy ──────
alter table crm_distribution_rules
  add column if not exists name text check (name is null or char_length(name) between 2 and 80),
  add column if not exists source_filter text[] not null default '{}'::text[],
  add column if not exists strategy text not null default 'round_robin'
    check (strategy in ('round_robin', 'specific', 'least_loaded')),
  add column if not exists last_assigned_at timestamptz,
  add column if not exists assigned_count int not null default 0 check (assigned_count >= 0);
