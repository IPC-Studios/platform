-- A quote could be created and deleted (while still a draft) but never
-- edited -- a wrong line item or price before it was ever sent meant
-- deleting the whole thing and starting over. update_quote() mirrors
-- create_quote()'s header+items replace, restricted to drafts the same
-- way delete already is: once sent, a quote is the record of the offer
-- actually made, not a draft to rewrite.
create or replace function update_quote(
  p_quote_id        uuid,
  p_title           text,
  p_valid_until     date,
  p_place_of_supply text,
  p_intra_state     boolean,
  p_subtotal        numeric,
  p_discount        numeric,
  p_taxable         numeric,
  p_tax             numeric,
  p_total           numeric,
  p_items           jsonb,
  p_notes           text default null,
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
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a quote needs at least one line' using errcode = '22023';
  end if;

  select status into v_status from crm_quotes where id = p_quote_id and company_id = v_company;
  if v_status is null then
    raise exception 'unknown quote' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'a quote that has been sent cannot be edited' using errcode = '23514';
  end if;

  update crm_quotes set
    title = p_title,
    valid_until = p_valid_until,
    place_of_supply = p_place_of_supply,
    intra_state = p_intra_state,
    subtotal = p_subtotal,
    discount = p_discount,
    taxable = p_taxable,
    tax = p_tax,
    total = p_total,
    notes = p_notes,
    terms = p_terms
  where id = p_quote_id;

  delete from crm_quote_items where quote_id = p_quote_id;

  insert into crm_quote_items (quote_id, company_id, description, quantity, rate, amount, gst_rate, taxable, cgst, sgst, igst, sort_order)
  select p_quote_id, v_company, e ->> 'description',
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(e, ord);
end;
$$;
revoke all on function update_quote(uuid, text, date, text, boolean, numeric, numeric, numeric, numeric, numeric, jsonb, text, text) from public, anon;
grant execute on function update_quote(uuid, text, date, text, boolean, numeric, numeric, numeric, numeric, numeric, jsonb, text, text) to authenticated;
