-- The original split each invoice line into a short bold label (what this
-- app's invoice_items.description already is -- "Wedding Photography
-- Package") and a separate subtext line underneath it ("Haldi + Wedding +
-- Reception coverage"). New had nowhere to put that second line. Nullable
-- and additive: an existing line item just has no subtext yet.
alter table invoice_items add column if not exists subtext text;

-- Same signature as 0087 -- subtext travels through the items jsonb payload,
-- not a new scalar parameter, so this is a body-only change.
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
  p_invoice_number  text default null
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
    due_date, place_of_supply, status, subtotal, discount, taxable, tax, total, balance_due,
    notes, template_id, created_by)
    values (v_company, p_client_id, p_project_id, v_number, coalesce(p_invoice_date, current_date),
      p_due_date, p_place_of_supply, 'sent', p_subtotal, p_discount, p_taxable, p_tax, p_total,
      p_total, p_notes, p_template_id, auth.uid())
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
  p_template_id     uuid default null
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
    taxable = p_taxable,
    tax = p_tax,
    total = p_total,
    balance_due = p_total,
    notes = p_notes,
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
