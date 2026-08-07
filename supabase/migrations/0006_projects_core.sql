-- Phase 4: the core — clients, projects, deliverables (SINGLE table + list_key,
-- per Fork 3), payments, services, shoots. Improvements over the original:
--   * every table carries company_id directly (no transitive tenancy)
--   * deliverables is ONE table with list_key (no deliverables/deliverables_2)
--   * additional_deliverables_cost is maintained by a TRIGGER (no write path can
--     skip the recompute) and total_cost is a GENERATED column

-- ── clients ───────────────────────────────────────────────────
create table clients (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies (id) on delete cascade,
  name            text not null,
  email           text,
  phone           text,
  alternate_phone text,
  address         text,
  city            text,
  notes           text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index clients_company_idx on clients (company_id);
create index clients_company_phone_idx on clients (company_id, phone);
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();

-- ── projects ──────────────────────────────────────────────────
create table projects (
  id                            uuid primary key default gen_random_uuid(),
  company_id                    uuid not null references companies (id) on delete cascade,
  client_id                     uuid not null references clients (id) on delete restrict,
  name                          text not null,
  status                        text not null default 'active'
                                  check (status in ('active', 'completed', 'cancelled', 'on_hold')),
  package_cost                  numeric(12, 2) not null default 0,
  -- Maintained by trigger from qualifying deliverables (see below).
  additional_deliverables_cost  numeric(12, 2) not null default 0,
  -- Never stored-and-recomputed: generated from the two above.
  total_cost                    numeric(12, 2)
                                  generated always as (package_cost + additional_deliverables_cost) stored,
  show_quotation                boolean not null default false,
  quotation_terms               text,
  quotation_display_prefs       jsonb not null default '{}'::jsonb,
  quotation_ack_token_hash      text,
  quotation_ack_token_expires_at timestamptz,
  quotation_acknowledged_at     timestamptz,
  quotation_acknowledged_by_name  text,
  quotation_acknowledged_by_email text,
  quotation_acknowledged_ip     text,
  quotation_acknowledged_user_agent text,
  created_by                    uuid references auth.users (id),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index projects_company_status_created_idx
  on projects (company_id, status, created_at desc);
create index projects_client_idx on projects (client_id);
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();

-- ── services (catalogue, per company) ─────────────────────────
create table services (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- ── shoots ────────────────────────────────────────────────────
create table shoots (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  name       text not null,
  shoot_date date,
  start_at   timestamptz,
  end_at     timestamptz,
  location   text,
  status     text not null default 'planned'
              check (status in ('planned', 'confirmed', 'completed', 'cancelled')),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shoots_company_project_idx on shoots (company_id, project_id);
create trigger shoots_set_updated_at before update on shoots
  for each row execute function set_updated_at();

create table shoot_services (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  shoot_id   uuid not null references shoots (id) on delete cascade,
  service_id uuid not null references services (id) on delete restrict,
  quantity   int not null default 1,
  notes      text
);
create index shoot_services_shoot_idx on shoot_services (shoot_id);

create table shoot_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  shoot_id     uuid not null references shoots (id) on delete cascade,
  user_id      uuid references users (user_id) on delete set null,
  service_name text,
  status       text not null default 'assigned'
                check (status in ('assigned', 'confirmed', 'declined')),
  created_at   timestamptz not null default now()
);
create index shoot_assignments_shoot_idx on shoot_assignments (shoot_id);

-- ── deliverables (ONE table, list_key) ────────────────────────
create table deliverables (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies (id) on delete cascade,
  project_id               uuid not null references projects (id) on delete cascade,
  shoot_id                 uuid references shoots (id) on delete set null,
  list_key                 text not null default 'primary',
  title                    text not null,
  description              text,
  status                   text not null default 'pending'
                            check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  custom_status_code       text,
  is_additional_charge     boolean not null default false,
  additional_charge_amount numeric(12, 2) not null default 0,
  estimated_date           date,
  visibility_scope         text not null default 'client'
                            check (visibility_scope in ('client', 'internal')),
  show_on_quotation        boolean not null default true,
  internal_notes           text,
  work_type                text,
  start_rule               text not null default 'whole_project'
                            check (start_rule in ('this_shoot', 'whole_project', 'specific_shoots', 'no_data')),
  delivery_days_after_start int,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index deliverables_project_idx on deliverables (project_id, list_key);
create trigger deliverables_set_updated_at before update on deliverables
  for each row execute function set_updated_at();

create table deliverable_shoot_links (
  company_id     uuid not null references companies (id) on delete cascade,
  deliverable_id uuid not null references deliverables (id) on delete cascade,
  shoot_id       uuid not null references shoots (id) on delete cascade,
  primary key (deliverable_id, shoot_id)
);

-- ── received_payments ─────────────────────────────────────────
create table received_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  project_id  uuid not null references projects (id) on delete cascade,
  amount      numeric(12, 2) not null check (amount >= 0),
  paid_on     date not null default current_date,
  mode        text,
  reference   text,
  notes       text,
  recorded_by uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index received_payments_project_idx on received_payments (project_id);

-- ── derived-total trigger: the one rule, enforced at the DB ───
create or replace function recompute_project_additional(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update projects p
    set additional_deliverables_cost = coalesce((
      select sum(d.additional_charge_amount)
      from deliverables d
      where d.project_id = p_project_id
        and d.visibility_scope = 'client'
        and d.show_on_quotation
        and d.is_additional_charge
    ), 0)
  where p.id = p_project_id;
$$;

create or replace function deliverables_recompute_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_project_additional(old.project_id);
    return old;
  end if;
  perform recompute_project_additional(new.project_id);
  if tg_op = 'UPDATE' and old.project_id <> new.project_id then
    perform recompute_project_additional(old.project_id);
  end if;
  return new;
end;
$$;

create trigger deliverables_recompute
  after insert or update or delete on deliverables
  for each row execute function deliverables_recompute_trigger();

-- ── RLS: company-scoped read, active-user write ───────────────
alter table clients                enable row level security;
alter table projects               enable row level security;
alter table services               enable row level security;
alter table shoots                 enable row level security;
alter table shoot_services         enable row level security;
alter table shoot_assignments      enable row level security;
alter table deliverables           enable row level security;
alter table deliverable_shoot_links enable row level security;
alter table received_payments      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','projects','services','shoots','shoot_services',
    'shoot_assignments','deliverables','deliverable_shoot_links','received_payments'
  ]
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

-- ── Atomic project creation ───────────────────────────────────
-- Project + deliverables + payments in one transaction. The trigger recomputes
-- totals as deliverables land. Tenancy is taken from the caller's context; the
-- API gates the projects.create permission before calling this.
create or replace function create_project_with_details(
  p_client_id     uuid,
  p_name          text,
  p_package_cost  numeric default 0,
  p_status        text default 'active',
  p_show_quotation boolean default false,
  p_deliverables  jsonb default '[]'::jsonb,
  p_payments      jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_project uuid;
begin
  if v_company is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id and company_id = v_company) then
    raise exception 'client not in this studio' using errcode = '42501';
  end if;

  insert into projects (company_id, client_id, name, package_cost, status, show_quotation, created_by)
    values (v_company, p_client_id, p_name, coalesce(p_package_cost, 0), coalesce(p_status, 'active'),
            coalesce(p_show_quotation, false), auth.uid())
    returning id into v_project;

  insert into deliverables (
    company_id, project_id, list_key, title, description,
    is_additional_charge, additional_charge_amount, visibility_scope,
    show_on_quotation, estimated_date, start_rule, delivery_days_after_start,
    work_type, internal_notes
  )
  select
    v_company, v_project,
    coalesce(e ->> 'list_key', 'primary'),
    e ->> 'title',
    e ->> 'description',
    coalesce((e ->> 'is_additional_charge')::boolean, false),
    coalesce((e ->> 'additional_charge_amount')::numeric, 0),
    coalesce(e ->> 'visibility_scope', 'client'),
    coalesce((e ->> 'show_on_quotation')::boolean, true),
    nullif(e ->> 'estimated_date', '')::date,
    coalesce(e ->> 'start_rule', 'whole_project'),
    nullif(e ->> 'delivery_days_after_start', '')::int,
    e ->> 'work_type',
    e ->> 'internal_notes'
  from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb)) as e
  where (e ->> 'title') is not null;

  insert into received_payments (company_id, project_id, amount, paid_on, mode, reference, notes, recorded_by)
  select
    v_company, v_project,
    (e ->> 'amount')::numeric,
    coalesce(nullif(e ->> 'paid_on', '')::date, current_date),
    e ->> 'mode', e ->> 'reference', e ->> 'notes', auth.uid()
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as e
  where (e ->> 'amount') is not null;

  return v_project;
end;
$$;

revoke all on function create_project_with_details(uuid, text, numeric, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function create_project_with_details(uuid, text, numeric, text, boolean, jsonb, jsonb) to authenticated;
