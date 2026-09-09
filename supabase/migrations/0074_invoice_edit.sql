-- An invoice went straight from creation to 'sent' with no way back --
-- a wrong client, line item, or GST slab had no fix short of leaving it
-- wrong or cancelling and starting over. update_invoice() mirrors
-- create_invoice()'s header+items replace, gated to invoices with no
-- payment recorded yet (once money has moved against a total, the
-- numbers are a ledger fact, not a draft to rewrite).
--
-- intra_state was a request-only input at creation time (it just picked
-- CGST+SGST vs IGST for the split); it was never persisted, so editing
-- has nothing to prefill the toggle from. Store it going forward,
-- backfilled from whichever split the existing line items actually used.
alter table invoices add column if not exists intra_state boolean not null default true;

update invoices set intra_state = false
  where id in (select invoice_id from invoice_items where igst > 0);

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
  p_notes           text default null
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
    notes = p_notes
  where id = p_invoice_id;

  delete from invoice_items where invoice_id = p_invoice_id;

  insert into invoice_items (invoice_id, company_id, description, quantity, rate, amount,
    gst_rate, taxable, cgst, sgst, igst, sort_order)
  select p_invoice_id, v_company, e ->> 'description',
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);
end;
$$;

revoke all on function update_invoice(uuid, uuid, uuid, text, boolean, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text) from public, anon;
grant execute on function update_invoice(uuid, uuid, uuid, text, boolean, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text) to authenticated;
