-- Lovable parity: expense parity (company + personal) + parties manager + attachments.
-- Additive only: new nullable columns, new tables.

-- Company expenses parity columns.
alter table expenses add column if not exists invoice_number text;
alter table expenses add column if not exists amount_is text not null default 'excluding_tax'
  check (amount_is in ('including_tax', 'excluding_tax'));
alter table expenses add column if not exists tax_name text;
alter table expenses add column if not exists tax_amount numeric(12, 2) not null default 0;
alter table expenses add column if not exists reverse_charge boolean not null default false;
alter table expenses add column if not exists itemize_json jsonb not null default '[]'::jsonb;

-- Parties manager columns (customer/phone/email/gstin/address/state/active).
alter table parties add column if not exists phone text;
alter table parties add column if not exists email text;
alter table parties add column if not exists gstin text;
alter table parties add column if not exists address text;
alter table parties add column if not exists state text;
alter table parties add column if not exists is_active boolean not null default true;

-- Personal expense parity columns (guarded: table is named personal_expense singular).
do $$
begin
  if to_regclass('public.personal_expense') is not null then
    alter table personal_expense add column if not exists invoice_number text;
    alter table personal_expense add column if not exists amount_is text not null default 'excluding_tax';
    alter table personal_expense add column if not exists tax_name text;
    alter table personal_expense add column if not exists tax_amount numeric(12,2) not null default 0;
    alter table personal_expense add column if not exists reverse_charge boolean not null default false;
    alter table personal_expense add column if not exists itemize_json jsonb not null default '[]'::jsonb;
  end if;
end $$;

-- Expense attachments (company + personal). Additive.
create table if not exists expense_attachments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  expense_id  uuid,
  personal_expense_id uuid,
  file_name   text not null,
  file_url    text not null,
  file_size   int,
  mime_type   text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table expense_attachments enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'expense_attachments_select') then
    create policy expense_attachments_select on expense_attachments for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'expense_attachments_write') then
    create policy expense_attachments_write on expense_attachments for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;
