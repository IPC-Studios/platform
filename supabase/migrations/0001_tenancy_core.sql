-- Phase 1: Tenancy & identity core.
-- Identity = Supabase Auth. Every person is a row in `users` keyed on
-- auth.users(id). Firebase is gone; there is no firebase_uid anywhere.

-- ── App role ladder ───────────────────────────────────────────
create type app_role as enum (
  'platform_admin',   -- the company selling the software (cross-tenant)
  'super_admin',      -- studio owner; bypasses every check in their tenant
  'admin',
  'manager',
  'employee'
);

-- ── Shared updated_at trigger ─────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── companies (one row = one tenant) ──────────────────────────
create table companies (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  -- Owner is a Supabase auth user. FK to auth.users (not `users`) to avoid a
  -- circular dependency; the owner's `users` row carries role = super_admin.
  owner_user_id        uuid not null references auth.users (id) on delete restrict,
  -- Access gates. plan_active = ANY of these three is in the future.
  plan                 text,
  plan_expiry          timestamptz,
  grandfathered_until  timestamptz,
  grace_until          timestamptz,
  legal_name           text,
  display_name         text,
  avatar_url           text,
  city                 text,
  state                text,
  country              text default 'India',
  website              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();

-- ── users (unified admins + employees) ────────────────────────
create table users (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  company_id      uuid not null references companies (id) on delete cascade,
  role            app_role not null default 'employee',
  name            text not null,
  email           text not null,
  phone           text,
  status          text not null default 'active' check (status in ('active', 'inactive', 'pending')),
  -- Employee-specific (nullable for admins). 1 = employee, 2 = manager (legacy).
  employee_type   int,
  salary          numeric(12, 2),
  address         text,
  engagement_type text,
  -- Soft delete, employees only.
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users (id),
  delete_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();

create index users_company_idx on users (company_id);
create index users_company_role_idx on users (company_id, role);
create index users_active_idx on users (company_id) where deleted_at is null;

-- ── employee_roles (per-company job roles: Photographer, Editor…) ──
create table employee_roles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  type_name  text not null,
  role_code  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, role_code)
);
create trigger employee_roles_set_updated_at before update on employee_roles
  for each row execute function set_updated_at();

create table employee_role_assignments (
  user_id    uuid not null references users (user_id) on delete cascade,
  role_id    uuid not null references employee_roles (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index era_role_idx on employee_role_assignments (role_id);

-- ── plans (platform-level catalogue) ──────────────────────────
create table plans (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,
  name             text not null,
  price            numeric(12, 2) not null default 0,
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  features         jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger plans_set_updated_at before update on plans
  for each row execute function set_updated_at();

-- ── coupons (platform-level, keyed on code) ───────────────────
create table coupons (
  code             text primary key,
  plan_id          uuid references plans (id) on delete set null,
  discount_percent numeric(5, 2),
  discount_flat    numeric(12, 2),
  valid_until      timestamptz,
  max_uses         int,
  used_count       int not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger coupons_set_updated_at before update on coupons
  for each row execute function set_updated_at();
create index coupons_plan_idx on coupons (plan_id);
