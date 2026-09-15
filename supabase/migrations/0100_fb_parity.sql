-- 0100: Facebook parity — connected pages + per-lead import log.
-- Minimal viable: fb_pages backs the status/pages UI (manual token flow when
-- OAuth is not configured); fb_lead_imports is the per-source import log the
-- lead-sources page reads. All additive, idempotent.

create table if not exists fb_pages (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  page_id           text not null,
  page_name         text not null,
  category          text,
  is_connected      boolean not null default false,
  webhook_subscribed boolean not null default false,
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, page_id)
);
create index if not exists fb_pages_company_idx on fb_pages (company_id, is_connected);
drop trigger if exists fb_pages_set_updated_at on fb_pages;
create trigger fb_pages_set_updated_at before update on fb_pages
  for each row execute function set_updated_at();

create table if not exists fb_lead_imports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  source_id   uuid references crm_webhook_sources (id) on delete set null,
  page_id     text,
  page_name   text,
  leadgen_id  text,
  name        text,
  phone       text,
  email       text,
  status      text not null default 'imported'
    check (status in ('imported', 'duplicate', 'failed', 'pending')),
  error       text,
  lead_id     uuid references crm_leads (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists fb_lead_imports_company_idx on fb_lead_imports (company_id, created_at desc);
create index if not exists fb_lead_imports_source_idx on fb_lead_imports (source_id, created_at desc);
create index if not exists fb_lead_imports_status_idx on fb_lead_imports (company_id, status, created_at desc);

alter table fb_pages        enable row level security;
alter table fb_lead_imports enable row level security;
do $$
declare t text;
begin
  foreach t in array array['fb_pages', 'fb_lead_imports'] loop
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
