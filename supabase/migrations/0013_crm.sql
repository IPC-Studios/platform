-- Phase 11: CRM & lead sources (core). Everything is a crm_lead with a source
-- (no legacy leads/enquiries tables). Leads arrive via webhook (Meta / generic
-- web form) or manually, are de-duplicated on normalized phone, and auto-
-- assigned across active distribution rules (balanced by current load).

-- Phone normaliser — MUST match @ipc/contracts normalizePhone byte-for-byte.
create or replace function crm_normalize_phone(p_input text)
returns text
language plpgsql
immutable
as $$
declare v text;
begin
  v := regexp_replace(coalesce(p_input, ''), '\D', '', 'g');
  if left(v, 2) = '00' then v := substr(v, 3); end if;
  if length(v) = 10 then v := '91' || v; end if;
  if length(v) > 15 then v := left(v, 15); end if;
  if length(v) < 7 then return null; end if;
  return v;
end;
$$;

create table crm_leads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  name         text,
  phone        text,
  phone_norm   text,
  email        text,
  source       text not null default 'manual'
                 check (source in ('facebook', 'webform', 'referral', 'manual', 'enquiry')),
  status       text not null default 'new'
                 check (status in ('new', 'contacted', 'qualified', 'converted', 'lost')),
  assigned_to  uuid references users (user_id) on delete set null,
  source_meta  jsonb not null default '{}'::jsonb,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index crm_leads_company_status_idx on crm_leads (company_id, status, created_at desc);
create index crm_leads_phone_norm_idx on crm_leads (company_id, phone_norm);
create trigger crm_leads_set_updated_at before update on crm_leads
  for each row execute function set_updated_at();

-- Distribution: active rows are the assignee pool (ordered by priority).
create table crm_distribution_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  user_id     uuid not null references users (user_id) on delete cascade,
  priority    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index cdr_company_idx on crm_distribution_rules (company_id, is_active, priority);

-- Webhook sources map an external key -> a company + source kind.
create table crm_webhook_sources (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  source_key text not null unique,
  kind       text not null default 'webform' check (kind in ('webform', 'meta')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table crm_leads              enable row level security;
alter table crm_distribution_rules enable row level security;
alter table crm_webhook_sources    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_leads','crm_distribution_rules','crm_webhook_sources']
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = get_current_company_id() and is_current_user_active())
         with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
  end loop;
end $$;

-- ── Lead capture (public webhook path) ────────────────────────
-- Resolves the company from the source key, dedupes on normalized phone, and
-- auto-assigns to the least-loaded active distribution assignee. Runs as anon
-- (webhooks are unauthenticated) — SECURITY DEFINER, no auth.uid() reliance.
create or replace function capture_lead(
  p_source_key text,
  p_name       text,
  p_phone      text,
  p_email      text default null,
  p_meta       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   crm_webhook_sources;
  v_norm     text := crm_normalize_phone(p_phone);
  v_existing uuid;
  v_assignee uuid;
  v_lead     uuid;
begin
  select * into v_source from crm_webhook_sources
    where source_key = p_source_key and is_active;
  if not found then
    raise exception 'unknown or inactive source' using errcode = '42501';
  end if;

  -- Dedupe: same normalized phone in this company -> return the existing lead.
  if v_norm is not null then
    select id into v_existing from crm_leads
      where company_id = v_source.company_id and phone_norm = v_norm
      limit 1;
    if found then return v_existing; end if;
  end if;

  -- Assign to the active distribution member with the fewest current leads.
  select r.user_id into v_assignee
    from crm_distribution_rules r
    where r.company_id = v_source.company_id and r.is_active
    order by (
      select count(*) from crm_leads l
      where l.company_id = v_source.company_id and l.assigned_to = r.user_id
    ) asc, r.priority asc
    limit 1;

  insert into crm_leads (company_id, name, phone, phone_norm, email, source, assigned_to, source_meta)
    values (v_source.company_id, p_name, p_phone, v_norm, p_email,
            case when v_source.kind = 'meta' then 'facebook' else 'webform' end,
            v_assignee, coalesce(p_meta, '{}'::jsonb))
    returning id into v_lead;
  return v_lead;
end;
$$;

revoke all on function capture_lead(text, text, text, text, jsonb) from public;
grant execute on function capture_lead(text, text, text, text, jsonb) to anon, authenticated;
