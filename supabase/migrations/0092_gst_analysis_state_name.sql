-- gst_analysis()'s "by_state" breakdown grouped by invoices.place_of_supply,
-- which stores the 2-digit GST state CODE (e.g. '27'), not a name -- so the
-- GST Analysis report rendered raw codes like "27" instead of "Maharashtra".
-- Resolve the code to its state_master name for display; keep grouping by the
-- code itself so distinct states never collide under a shared/missing name.
create or replace function gst_analysis(p_start_date date, p_end_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_result  jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,
    'total_income', coalesce((
      select sum(rp.amount) from received_payments rp
       where rp.company_id = v_company and rp.paid_on between p_start_date and p_end_date), 0)::numeric,
    'total_expenses', coalesce((
      select sum(e.amount) from expenses e
       where e.company_id = v_company and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'gst_collected', coalesce((
      select sum(ii.cgst + ii.sgst + ii.igst)
        from invoice_items ii join invoices i on i.id = ii.invoice_id
       where i.company_id = v_company and i.invoice_date between p_start_date and p_end_date), 0)::numeric,
    'gst_paid', coalesce((
      select sum(e.amount * e.gst_rate / 100.0) from expenses e
       where e.company_id = v_company and e.gst_treatment = 'gst_applicable'
         and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'input_tax_credit', coalesce((
      select sum(e.amount * e.gst_rate / 100.0) from expenses e
       where e.company_id = v_company and e.gst_treatment = 'gst_applicable'
         and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'reverse_charge', coalesce((
      select sum(e.amount * e.gst_rate / 100.0) from expenses e
       where e.company_id = v_company and e.gst_treatment = 'reverse_charge'
         and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'net_gst_liability', 0::numeric,
    'by_state', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from (
        select coalesce(sm.name, i.place_of_supply, 'Unknown') as state,
               sum(ii.taxable) as income,
               sum(ii.cgst + ii.sgst + ii.igst) as gst
          from invoice_items ii
          join invoices i on i.id = ii.invoice_id
          left join state_master sm on sm.code = i.place_of_supply
         where i.company_id = v_company and i.invoice_date between p_start_date and p_end_date
         group by coalesce(sm.name, i.place_of_supply, 'Unknown')
      ) s
    ),
    'by_gst_rate', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      from (
        select ii.gst_rate as rate,
               sum(ii.taxable) as taxable_amount,
               sum(ii.cgst) as cgst,
               sum(ii.sgst) as sgst,
               sum(ii.igst) as igst
          from invoice_items ii join invoices i on i.id = ii.invoice_id
         where i.company_id = v_company and i.invoice_date between p_start_date and p_end_date
         group by ii.gst_rate
         order by ii.gst_rate
      ) r
    )
  ) into v_result;

  declare
    v_collected numeric := (v_result->>'gst_collected')::numeric;
    v_credit    numeric := (v_result->>'input_tax_credit')::numeric;
  begin
    v_result := jsonb_set(v_result, '{net_gst_liability}', to_jsonb(greatest(0, v_collected - v_credit)));
  end;

  return v_result;
end;
$$;
