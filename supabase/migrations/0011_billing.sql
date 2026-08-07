-- Phase 9: billing & invoicing. GST split computed in @ipc/domain (tested) and
-- persisted here. Invoice numbers are assigned atomically under a company row
-- lock. Payments recompute amount_paid/balance/status in one transaction.

-- Invoice numbering config on the tenant.
alter table companies add column if not exists invoice_number_prefix text not null default 'INV-';
alter table companies add column if not exists invoice_next_number int not null default 1;
alter table companies add column if not exists invoice_gst_number text;

-- GST state codes for place-of-supply.
create table state_master (
  code text primary key,   -- GST state code, e.g. '27'
  name text not null
);
insert into state_master (code, name) values
  ('27', 'Maharashtra'), ('07', 'Delhi'), ('29', 'Karnataka'),
  ('33', 'Tamil Nadu'), ('09', 'Uttar Pradesh'), ('24', 'Gujarat'),
  ('19', 'West Bengal'), ('36', 'Telangana')
on conflict (code) do nothing;

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies (id) on delete cascade,
  client_id       uuid references clients (id) on delete set null,
  project_id      uuid references projects (id) on delete set null,
  invoice_number  text not null,
  invoice_date    date not null default current_date,
  due_date        date,
  place_of_supply text references state_master (code),
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'partial', 'paid', 'cancelled')),
  subtotal        numeric(12, 2) not null default 0,
  discount        numeric(12, 2) not null default 0,
  taxable         numeric(12, 2) not null default 0,
  tax             numeric(12, 2) not null default 0,
  total           numeric(12, 2) not null default 0,
  amount_paid     numeric(12, 2) not null default 0,
  balance_due     numeric(12, 2) not null default 0,
  notes           text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, invoice_number)
);
create index invoices_company_status_idx on invoices (company_id, status, invoice_date desc);
create trigger invoices_set_updated_at before update on invoices
  for each row execute function set_updated_at();

create table invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  description text not null,
  quantity    numeric(10, 2) not null default 1,
  rate        numeric(12, 2) not null default 0,
  amount      numeric(12, 2) not null default 0,
  gst_rate    numeric(5, 2) not null default 0,
  taxable     numeric(12, 2) not null default 0,
  cgst        numeric(12, 2) not null default 0,
  sgst        numeric(12, 2) not null default 0,
  igst        numeric(12, 2) not null default 0,
  sort_order  int not null default 0
);
create index invoice_items_invoice_idx on invoice_items (invoice_id);

create table invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  amount     numeric(12, 2) not null check (amount > 0),
  paid_on    date not null default current_date,
  mode       text,
  reference  text,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on invoice_payments (invoice_id);

alter table state_master enable row level security;
alter table invoices        enable row level security;
alter table invoice_items   enable row level security;
alter table invoice_payments enable row level security;

-- state_master is a shared lookup: any authenticated user may read.
create policy state_master_select on state_master for select to authenticated using (true);

-- Tenant isolation at the DB; the finance-module gate is enforced by the API
-- (requireModule('billing')). Phase 16 can tighten to a DB-level finance predicate.
do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_items','invoice_payments']
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

-- ── Atomic invoice number ─────────────────────────────────────
create or replace function next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_num    int;
begin
  update companies
    set invoice_next_number = invoice_next_number + 1
    where id = get_current_company_id()
    returning invoice_number_prefix, invoice_next_number - 1 into v_prefix, v_num;
  return v_prefix || lpad(v_num::text, 4, '0');
end;
$$;

-- ── Create invoice (header + items) atomically ────────────────
-- Totals + per-item GST are computed by @ipc/domain and passed in; this just
-- assigns the number and persists in one transaction.
create or replace function create_invoice(
  p_client_id       uuid,
  p_project_id      uuid,
  p_place_of_supply text,
  p_invoice_date    date,
  p_due_date        date,
  p_subtotal        numeric,
  p_discount        numeric,
  p_taxable         numeric,
  p_tax             numeric,
  p_total           numeric,
  p_items           jsonb,
  p_notes           text default null
)
returns table (id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_number  text := next_invoice_number();
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date,
    due_date, place_of_supply, status, subtotal, discount, taxable, tax, total, balance_due,
    notes, created_by)
    values (v_company, p_client_id, p_project_id, v_number, coalesce(p_invoice_date, current_date),
      p_due_date, p_place_of_supply, 'sent', p_subtotal, p_discount, p_taxable, p_tax, p_total,
      p_total, p_notes, auth.uid())
    returning invoices.id into v_id;

  insert into invoice_items (invoice_id, company_id, description, quantity, rate, amount,
    gst_rate, taxable, cgst, sgst, igst, sort_order)
  select v_id, v_company, e ->> 'description',
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  return query select v_id, v_number;
end;
$$;

-- ── Record a payment + recompute status ───────────────────────
create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_paid_on    date default null,
  p_mode       text default null,
  p_reference  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_total   numeric;
  v_paid    numeric;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from invoices where id = p_invoice_id and company_id = v_company) then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;

  insert into invoice_payments (invoice_id, company_id, amount, paid_on, mode, reference)
    values (p_invoice_id, v_company, p_amount, coalesce(p_paid_on, current_date), p_mode, p_reference);

  select total into v_total from invoices where id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from invoice_payments where invoice_id = p_invoice_id;

  update invoices
    set amount_paid = v_paid,
        balance_due = greatest(0, v_total - v_paid),
        status = case when v_paid >= v_total then 'paid'
                      when v_paid > 0 then 'partial' else status end
    where id = p_invoice_id;
end;
$$;

revoke all on function next_invoice_number()                                       from public, anon;
revoke all on function create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text) from public, anon;
revoke all on function record_invoice_payment(uuid, numeric, date, text, text)     from public, anon;
grant execute on function next_invoice_number()                                       to authenticated;
grant execute on function create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text) to authenticated;
grant execute on function record_invoice_payment(uuid, numeric, date, text, text)     to authenticated;
