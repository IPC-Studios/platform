-- Reusable bank/UPI accounts stamped onto invoices (Lovable parity).
-- An invoice keeps a text snapshot (invoices.bank_details); this table is the
-- library it is picked from, so editing an account never rewrites history.
create table if not exists invoice_bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  label       text not null,
  holder      text,
  bank        text,
  number      text,
  ifsc        text,
  upi         text,
  branch      text,
  notes       text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists invoice_bank_accounts_company_idx on invoice_bank_accounts (company_id);

drop trigger if exists invoice_bank_accounts_set_updated_at on invoice_bank_accounts;
create trigger invoice_bank_accounts_set_updated_at before update on invoice_bank_accounts
  for each row execute function set_updated_at();

alter table invoice_bank_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'invoice_bank_accounts_select') then
    create policy invoice_bank_accounts_select on invoice_bank_accounts for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'invoice_bank_accounts_write') then
    create policy invoice_bank_accounts_write on invoice_bank_accounts for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;
