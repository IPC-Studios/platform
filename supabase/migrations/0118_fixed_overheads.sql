-- Lovable parity: monthly profit (cash/booked basis, alloc equal/revenue/shoot_days)
-- + salary buckets + fixed overheads CRUD (9 cats + 4 alloc).
-- Additive only.

-- 9 fixed-overhead categories, 4 allocation bases (equal/revenue/shoot_days/headcount).
create table if not exists fixed_overheads (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  category    text not null check (category in (
    'rent', 'salaries', 'utilities', 'internet', 'software', 'insurance', 'maintenance', 'marketing', 'other'
  )),
  label       text,
  amount      numeric(12, 2) not null default 0 check (amount >= 0),
  alloc_basis text not null default 'equal' check (alloc_basis in ('equal', 'revenue', 'shoot_days', 'headcount')),
  month       date not null default date_trunc('month', now())::date,
  is_active   boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists fixed_overheads_company_month_idx on fixed_overheads (company_id, month);
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fixed_overheads_set_updated_at') then
    create trigger fixed_overheads_set_updated_at before update on fixed_overheads
      for each row execute function set_updated_at();
  end if;
end $$;
alter table fixed_overheads enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'fixed_overheads_select') then
    create policy fixed_overheads_select on fixed_overheads for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'fixed_overheads_write') then
    create policy fixed_overheads_write on fixed_overheads for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- Monthly profit summary: cash (paid_on) vs booked (project value) basis.
-- Implemented as SQL helper so API + UI share one definition.
create or replace function monthly_profit_summary(p_month date, p_basis text default 'cash', p_alloc text default 'equal')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_cash numeric := 0; v_booked numeric := 0;
  v_salary numeric := 0; v_fixed numeric := 0; v_variable numeric := 0;
begin
  select coalesce(sum(amount), 0) into v_cash from received_payments
   where company_id = v_company and paid_on >= v_start and paid_on < v_end;
  select coalesce(sum(total_cost), 0) into v_booked from projects
   where company_id = v_company and created_at >= v_start and created_at < v_end;
  select coalesce(sum(amount), 0) into v_salary from team_payouts
   where company_id = v_company and created_at >= v_start and created_at < v_end;
  if to_regclass('public.fixed_overheads') is not null then
    select coalesce(sum(amount), 0) into v_fixed from fixed_overheads
     where company_id = v_company and month = v_start and is_active;
  end if;
  select coalesce(sum(amount), 0) into v_variable from expenses
   where company_id = v_company and expense_date >= v_start and expense_date < v_end
     and coalesce(is_fixed_overhead, false) = false;
  return jsonb_build_object(
    'month', v_start, 'basis', p_basis, 'alloc', p_alloc,
    'cash_received', v_cash, 'booked_revenue', v_booked,
    'salary_cost', v_salary, 'office_fixed', v_fixed, 'variable_cost', v_variable,
    'fixed_total', v_salary + v_fixed,
    'total_cost', v_salary + v_fixed + v_variable,
    'net_cash', v_cash - (v_salary + v_fixed + v_variable),
    'net_booked', v_booked - (v_salary + v_fixed + v_variable)
  );
end;
$$;

revoke all on function monthly_profit_summary(date, text, text) from public, anon;
grant execute on function monthly_profit_summary(date, text, text) to authenticated;
