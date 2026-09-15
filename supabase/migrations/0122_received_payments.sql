-- Standalone received_payments module (Lovable billing parity).
-- The table predates this module (0006 + 0103 added status/description/GST),
-- so this migration is idempotent: create-if-missing plus add-column-if-missing
-- for the standalone-module columns (client_id, date_received, file_url).
-- Existing rows keep behaviour: date_received backfills from paid_on, and the
-- API reads COALESCE(date_received, paid_on) so legacy rows keep sorting.

create table if not exists received_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  project_id    uuid not null references projects (id) on delete cascade,
  client_id     uuid references clients (id) on delete set null,
  amount        numeric(12, 2) not null check (amount > 0),
  description   text,
  status        text not null default 'paid' check (status in ('paid', 'pending')),
  is_gst        boolean not null default false,
  gst_number    text,
  date_received date,
  file_url      text,
  created_at    timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'client_id') then
    alter table received_payments add column client_id uuid references clients (id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'description') then
    alter table received_payments add column description text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'status') then
    alter table received_payments add column status text not null default 'paid' check (status in ('paid', 'pending'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'is_gst') then
    alter table received_payments add column is_gst boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'gst_number') then
    alter table received_payments add column gst_number text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'date_received') then
    alter table received_payments add column date_received date;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'file_url') then
    alter table received_payments add column file_url text;
  end if;
end $$;

-- Backfill the new date column from the legacy paid_on where present.
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'paid_on')
     and exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'date_received') then
    update received_payments set date_received = paid_on where date_received is null and paid_on is not null;
  end if;
  -- Backfill client from the linked project where the standalone column is empty.
  if exists (select 1 from information_schema.columns where table_name = 'received_payments' and column_name = 'client_id') then
    update received_payments rp set client_id = p.client_id
      from projects p
     where rp.client_id is null and p.id = rp.project_id and p.client_id is not null;
  end if;
end $$;

create index if not exists received_payments_company_idx on received_payments (company_id);
create index if not exists received_payments_client_idx on received_payments (client_id);
create index if not exists received_payments_date_idx on received_payments (date_received);
create index if not exists received_payments_status_idx on received_payments (status);

-- Invoice form gaps (Lovable parity): per-invoice GSTIN snapshot + 'none'
-- discount type. Additive; existing rows keep behaviour.
alter table invoices add column if not exists gst_number text;

do $$ begin
  -- Widen the discount_type check to include 'none' (default PG constraint name).
  if exists (
    select 1 from pg_constraint where conname = 'invoices_discount_type_check'
  ) then
    alter table invoices drop constraint invoices_discount_type_check;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_discount_type_check'
  ) then
    alter table invoices add constraint invoices_discount_type_check
      check (discount_type in ('flat', 'percent', 'none'));
  end if;
end $$;
