-- The original let a studio type its own invoice number, falling back to the
-- auto-numbered sequence only when left blank. New always auto-numbered, with
-- no override anywhere. A manual number must not also consume the sequence --
-- next_invoice_number() only runs when none was supplied.
drop function if exists create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid);

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

revoke all on function create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text) from public, anon;
grant execute on function create_invoice(uuid, uuid, text, date, date, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text) to authenticated;
