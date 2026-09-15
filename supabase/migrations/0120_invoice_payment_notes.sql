-- Billing parity: payment notes, per-invoice snapshots, company defaults,
-- note template types, and preset seeds. Additive; existing rows keep behaviour.

-- 1) Payment notes
alter table invoice_payments add column if not exists notes text;

-- 2) Per-invoice snapshots + persisted discount type
alter table invoices add column if not exists discount_type text not null default 'flat'
  check (discount_type in ('flat', 'percent'));
alter table invoices add column if not exists bank_details text;
alter table invoices add column if not exists terms text;

-- 3) Company invoice defaults (Lovable branding parity; logo stays avatar_url)
alter table companies add column if not exists invoice_address text;
alter table companies add column if not exists invoice_phone text;
alter table companies add column if not exists invoice_email text;
alter table companies add column if not exists invoice_upi_id text;
alter table companies add column if not exists invoice_bank_details text;
alter table companies add column if not exists invoice_default_notes text;
alter table companies add column if not exists invoice_default_terms text;

-- 4) Note templates gain a type so Terms and Notes share one library.
-- Legacy rows (notes-only) read as 'note'.
alter table invoice_note_templates add column if not exists template_type text not null default 'note'
  check (template_type in ('terms', 'note'));

-- 5) Seed the 14 photo presets for studios that have none (0085 backfilled
-- existing studios and seeds new ones via trigger; this covers studios that
-- were created in between or had the category cleared).
insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'invoice_line_preset', v.value, v.sort_order, true
from companies c
cross join (values
  ('Wedding Photography Package', 1),
  ('Traditional Photography', 2),
  ('Candid Photography', 3),
  ('Cinematography', 4),
  ('Drone Coverage', 5),
  ('Pre-Wedding Shoot', 6),
  ('Edited Photos', 7),
  ('Wedding Film', 8),
  ('Highlight Film', 9),
  ('Photo Album', 10),
  ('Raw Data', 11),
  ('Extra Event Coverage', 12),
  ('Travel Charges', 13),
  ('Same Day Edit', 14)
) as v(value, sort_order)
where not exists (
  select 1 from custom_lookups cl
  where cl.company_id = c.id and cl.category = 'invoice_line_preset' and cl.is_active = true
)
on conflict (company_id, category, value) do nothing;

-- 6) Seed recommended Terms + Notes templates for studios with an empty library.
insert into invoice_note_templates (company_id, template_type, title, content, is_default)
select c.id, v.template_type, v.title, v.content, v.is_default
from companies c
cross join (values
  ('terms', 'Standard Payment Terms', '1. Booking is confirmed only after advance payment.\n2. Remaining payment must be cleared before final delivery.\n3. Taxes, travel, stay and logistics are charged as applicable.\n4. Delivery timeline depends on selected package and payment clearance.', true),
  ('terms', 'Wedding Booking Terms', '1. 50% advance confirms the booking.\n2. Balance is due before final delivery of photos/videos.\n3. Additional events / extra hours are billed separately.\n4. Travel and stay outside city are charged at actuals.', false),
  ('terms', 'Final Delivery Terms', '1. Edited photos and videos are delivered after full payment is received.\n2. Raw data is shared only on request and may attract additional charges.\n3. Re-edits beyond the agreed scope are chargeable.', false),
  ('note', 'Thank You Note', 'Thank you for choosing our photography services. We loved capturing your moments.', true),
  ('note', 'Payment Screenshot Note', 'Kindly share the payment screenshot once the transfer is complete. Please mention the invoice number while making payment.', false)
) as v(template_type, title, content, is_default)
where not exists (
  select 1 from invoice_note_templates t
  where t.company_id = c.id and t.is_active = true
)
on conflict do nothing;

-- 7) Rewrite the RPCs with the new trailing params (named-arg calls everywhere,
-- so drop first to avoid the ambiguous-overload trap seen in 0078/0087).
drop function if exists create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text);
drop function if exists update_invoice(uuid, uuid, uuid, text, boolean, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid);
drop function if exists record_invoice_payment(uuid, numeric, date, text, text);

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
  p_notes           text default null,
  p_template_id     uuid default null,
  p_invoice_number  text default null,
  p_discount_type   text default 'flat',
  p_bank_details    text default null,
  p_terms           text default null
)
returns table (id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_number  text;
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_template_id is not null and not exists (
    select 1 from invoice_templates where invoice_templates.id = p_template_id and company_id = v_company
  ) then
    raise exception 'template not in this studio' using errcode = '42501';
  end if;

  v_number := nullif(trim(p_invoice_number), '');
  if v_number is null then
    v_number := next_invoice_number();
  end if;

  insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date,
    due_date, place_of_supply, status, subtotal, discount, discount_type, taxable, tax, total, balance_due,
    notes, bank_details, terms, template_id, created_by)
    values (v_company, p_client_id, p_project_id, v_number, coalesce(p_invoice_date, current_date),
      p_due_date, p_place_of_supply, 'sent', p_subtotal, p_discount,
      coalesce(nullif(trim(p_discount_type), ''), 'flat'),
      p_taxable, p_tax, p_total,
      p_total, p_notes, nullif(trim(p_bank_details), ''), nullif(trim(p_terms), ''), p_template_id, auth.uid())
    returning invoices.id into v_id;

  insert into invoice_items (invoice_id, company_id, description, subtext, quantity, rate, amount,
    gst_rate, taxable, cgst, sgst, igst, sort_order)
  select v_id, v_company, e ->> 'description', nullif(e ->> 'subtext', ''),
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  return query select v_id, v_number;
end;
$$;

create or replace function update_invoice(
  p_invoice_id      uuid,
  p_client_id       uuid,
  p_project_id      uuid,
  p_place_of_supply text,
  p_intra_state     boolean,
  p_invoice_date    date,
  p_due_date        date,
  p_subtotal        numeric,
  p_discount        numeric,
  p_taxable         numeric,
  p_tax             numeric,
  p_total           numeric,
  p_items           jsonb,
  p_notes           text default null,
  p_template_id     uuid default null,
  p_discount_type   text default null,
  p_bank_details    text default null,
  p_terms           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_status  text;
  v_paid    numeric;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_template_id is not null and not exists (
    select 1 from invoice_templates where invoice_templates.id = p_template_id and company_id = v_company
  ) then
    raise exception 'template not in this studio' using errcode = '42501';
  end if;

  select status, amount_paid into v_status, v_paid
    from invoices where id = p_invoice_id and company_id = v_company;

  if v_status is null then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;
  if v_status = 'cancelled' or v_paid > 0 then
    raise exception 'an invoice with a recorded payment cannot be edited' using errcode = '23514';
  end if;

  update invoices set
    client_id = p_client_id,
    project_id = p_project_id,
    place_of_supply = p_place_of_supply,
    intra_state = p_intra_state,
    invoice_date = coalesce(p_invoice_date, invoice_date),
    due_date = p_due_date,
    subtotal = p_subtotal,
    discount = p_discount,
    discount_type = coalesce(nullif(trim(p_discount_type), ''), discount_type, 'flat'),
    taxable = p_taxable,
    tax = p_tax,
    total = p_total,
    balance_due = p_total,
    notes = p_notes,
    bank_details = nullif(trim(p_bank_details), ''),
    terms = nullif(trim(p_terms), ''),
    template_id = p_template_id
  where id = p_invoice_id;

  delete from invoice_items where invoice_id = p_invoice_id;

  insert into invoice_items (invoice_id, company_id, description, subtext, quantity, rate, amount,
    gst_rate, taxable, cgst, sgst, igst, sort_order)
  select p_invoice_id, v_company, e ->> 'description', nullif(e ->> 'subtext', ''),
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);
end;
$$;

create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_paid_on    date default null,
  p_mode       text default null,
  p_reference  text default null,
  p_notes      text default null
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

  insert into invoice_payments (invoice_id, company_id, amount, paid_on, mode, reference, notes)
    values (p_invoice_id, v_company, p_amount, coalesce(p_paid_on, current_date), p_mode, p_reference, nullif(trim(p_notes), ''));

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

revoke all on function create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text, text, text, text) from public, anon;
revoke all on function update_invoice(uuid, uuid, uuid, text, boolean, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text, text, text) from public, anon;
revoke all on function record_invoice_payment(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text, text, text, text) to authenticated;
grant execute on function update_invoice(uuid, uuid, uuid, text, boolean, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text, text, text) to authenticated;
grant execute on function record_invoice_payment(uuid, numeric, date, text, text, text) to authenticated;
