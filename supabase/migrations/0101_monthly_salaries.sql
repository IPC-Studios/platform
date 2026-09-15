-- PEOPLE parity: compensation split + monthly salaries ledger.
-- Additive only: new column + new ledger columns on the existing table.

-- 1. Freelancer rate lives beside salary (monthly_salary vs freelancer_rate
-- were binding the same `salary` input in the UI).
alter table users add column if not exists freelancer_rate numeric(12,2)
  check (freelancer_rate is null or freelancer_rate >= 0);

-- 2. Monthly salaries ledger. monthly_salaries already exists (0014) with a
-- (company_id, user_id, month date) shape and gross/deductions/net +
-- draft/finalised/paid statuses. The PEOPLE ledger needs a calendar
-- month/year + base/paid + unpaid/partial/paid view of the same rows, so
-- extend the table rather than replacing it.
alter table monthly_salaries add column if not exists pay_month int
  check (pay_month is null or (pay_month between 1 and 12));
alter table monthly_salaries add column if not exists pay_year int
  check (pay_year is null or (pay_year between 2000 and 2100));
alter table monthly_salaries add column if not exists base_amount numeric(12,2)
  check (base_amount is null or base_amount >= 0);
alter table monthly_salaries add column if not exists paid_amount numeric(12,2) not null default 0;
alter table monthly_salaries add column if not exists created_at timestamptz not null default now();

-- Widen the status check to the ledger states (keep the old ones for rows
-- written before this migration).
alter table monthly_salaries drop constraint if exists monthly_salaries_status_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_salaries_status_check2') then
    alter table monthly_salaries add constraint monthly_salaries_status_check2
      check (status in ('draft', 'finalised', 'paid', 'unpaid', 'partial', 'partially_paid'));
  end if;
end $$;

-- One row per person per calendar month (new scheme). The old
-- (company_id, user_id, month) unique stays for legacy rows.
create unique index if not exists monthly_salaries_company_user_ym_idx
  on monthly_salaries (company_id, user_id, pay_year, pay_month)
  where pay_year is not null and pay_month is not null;
create index if not exists monthly_salaries_company_ym_idx
  on monthly_salaries (company_id, pay_year, pay_month);

-- Backfill the new columns from legacy rows so old + new rows read the same.
update monthly_salaries
   set pay_month = extract(month from month)::int,
       pay_year = extract(year from month)::int,
       base_amount = coalesce(base_amount, gross, 0),
       paid_amount = coalesce(paid_amount, 0)
 where pay_month is null or pay_year is null or base_amount is null;

-- RLS: the 0014 select policy is owner-only. Managers need to view the
-- ledger; owner/admin write it (the API re-checks: manager writes are
-- refused there even though RLS below is permissive).
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'monthly_salaries_select_team') then
    create policy monthly_salaries_select_team on monthly_salaries
      for select to authenticated
      using (company_id = get_current_company_id() and is_current_admin_or_manager());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'monthly_salaries_write_team') then
    create policy monthly_salaries_write_team on monthly_salaries
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_admin_or_manager())
      with check (company_id = get_current_company_id() and is_current_admin_or_manager());
  end if;
end $$;
