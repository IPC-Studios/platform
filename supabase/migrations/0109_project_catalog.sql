-- Lovable parity: granular project catalog (separate from generic project_templates).
-- ShootType library + Deliverable templates + Workflow presets with usage + archive.
-- Additive only.
create table if not exists shoot_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  category text,
  usage_count int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists deliverable_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  title text not null,
  shoot_type text,
  delivery_days int,
  due_basis text,
  brief text,
  is_combined boolean not null default false,
  usage_count int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists workflow_presets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  shoot_type text,
  shoot_time text,
  shoot_city text,
  requirements jsonb not null default '[]'::jsonb,
  deliverables jsonb not null default '[]'::jsonb,
  usage_count int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['shoot_types','deliverable_templates','workflow_presets']
  loop
    execute format('alter table %I enable row level security;', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_select') then
      execute format('create policy %I_select on %I for select to authenticated using (company_id = get_current_company_id());', t, t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_write') then
      execute format('create policy %I_write on %I for all to authenticated using (company_id = get_current_company_id() and is_current_user_active()) with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
    end if;
  end loop;
end $$;
