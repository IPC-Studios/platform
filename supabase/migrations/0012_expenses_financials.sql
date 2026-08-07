-- Phase 10: expenses & financials. The profit formula is reproduced by the
-- project_financials view exactly as @ipc/domain computes it:
--   Gross Profit = Revenue(total_cost) − Direct team cost − Project expenses

create table expense_categories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table parties (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  kind       text not null default 'vendor' check (kind in ('vendor', 'freelancer', 'other')),
  created_at timestamptz not null default now()
);

create table expenses (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies (id) on delete cascade,
  project_id             uuid references projects (id) on delete set null,
  party_id               uuid references parties (id) on delete set null,
  category               text,
  description            text,
  amount                 numeric(12, 2) not null check (amount >= 0),
  expense_date           date not null default current_date,
  gst_treatment          text not null default 'non_gst'
                           check (gst_treatment in ('non_gst', 'gst_applicable', 'exempt', 'reverse_charge')),
  is_fixed_overhead      boolean not null default false,
  fixed_overhead_category text,
  allocation_method      text default 'equal'
                           check (allocation_method in ('equal', 'revenue_weighted', 'shoot_days_weighted')),
  created_by             uuid references auth.users (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index expenses_company_project_idx on expenses (company_id, project_id);
create index expenses_date_idx on expenses (company_id, expense_date);
create trigger expenses_set_updated_at before update on expenses
  for each row execute function set_updated_at();

create table personal_expense (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references users (user_id) on delete cascade,
  party_id      uuid references parties (id) on delete set null,
  amount        numeric(12, 2) not null check (amount >= 0),
  expense_date  date not null default current_date,
  category      text,
  gst_treatment text not null default 'non_gst',
  description   text,
  created_at    timestamptz not null default now()
);
create index personal_expense_user_idx on personal_expense (user_id);

create table expense_attachments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies (id) on delete cascade,
  expense_id          uuid references expenses (id) on delete cascade,
  personal_expense_id uuid references personal_expense (id) on delete cascade,
  url                 text not null,
  created_at          timestamptz not null default now()
);

-- ── Profit view (tenant-isolated via security_invoker) ────────
create view project_financials
with (security_invoker = on) as
select
  p.id         as project_id,
  p.company_id,
  p.name,
  p.total_cost as revenue,
  coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id), 0) as received,
  coalesce((
    select sum(coalesce(s.final_cost, s.estimated_cost))
    from team_assignment_slots s
    where s.shoot_id in (select id from shoots where project_id = p.id)
      and s.status not in ('cancelled', 'released')
  ), 0) as direct_team_cost,
  coalesce((select sum(e.amount) from expenses e where e.project_id = p.id), 0) as project_expenses
from projects p;

alter table expense_categories  enable row level security;
alter table parties             enable row level security;
alter table expenses            enable row level security;
alter table personal_expense    enable row level security;
alter table expense_attachments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['expense_categories','parties','expenses','expense_attachments']
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

-- Personal expenses: each user sees + manages only their own.
create policy personal_expense_own on personal_expense
  for all to authenticated
  using (company_id = get_current_company_id() and user_id = auth.uid())
  with check (company_id = get_current_company_id() and user_id = auth.uid());
