-- Financial filters and GST analysis: RPC for GST reporting with date range filters.
create or replace function gst_analysis(
  p_start_date date,
  p_end_date   date
)
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
    'total_income', coalesce((select sum(rp.amount) from received_payments rp where rp.company_id = v_company and rp.paid_on between p_start_date and p_end_date), 0)::numeric,
    'total_expenses', coalesce((select sum(e.amount) from expenses e where e.company_id = v_company and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'gst_collected', coalesce((select sum((i.subtotal - i.discount) * i.items_gst_rate / 100) from invoices i where i.company_id = v_company and i.invoice_date between p_start_date and p_end_date), 0)::numeric,
    'gst_paid', coalesce((select sum(case when e.gst_treatment = 'gst_applicable' then e.amount * e.gst_rate / 100.0 else 0 end) from expenses e where e.company_id = v_company and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'net_gst_liability', 0::numeric,
    'reverse_charge', 0::numeric,
    'input_tax_credit', coalesce((select sum(case when e.gst_treatment = 'gst_applicable' then e.amount * e.gst_rate / 100.0 else 0 end) from expenses e where e.company_id = v_company and e.expense_date between p_start_date and p_end_date), 0)::numeric,
    'by_state', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from (
        select coalesce(i.place_of_supply, 'Unknown') as state,
               sum((i.subtotal - i.discount)) as income,
               sum((i.subtotal - i.discount) * i.items_gst_rate / 100) as gst
          from invoices i
         where i.company_id = v_company
           and i.invoice_date between p_start_date and p_end_date
         group by i.place_of_supply
      ) s
    ),
    'by_gst_rate', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      from (
        select ii.gst_rate as rate,
               sum(ii.amount) as taxable_amount,
               sum(ii.cgst) as cgst,
               sum(ii.sgst) as sgst,
               sum(ii.igst) as igst
          from invoice_items ii
          join invoices i on i.id = ii.invoice_id
         where i.company_id = v_company
           and i.invoice_date between p_start_date and p_end_date
         group by ii.gst_rate
         order by ii.gst_rate
      ) r
    )
  ) into v_result;

  -- Compute net GST liability
  declare
    v_collected numeric := (v_result->>'gst_collected')::numeric;
    v_paid      numeric := (v_result->>'gst_paid')::numeric;
  begin
    v_result := jsonb_set(v_result, '{net_gst_liability}', to_jsonb(greatest(0, v_collected - v_paid)));
  end;

  return v_result;
end;
$$;

revoke all on function gst_analysis(date, date) from public, anon;
grant execute on function gst_analysis(date, date) to authenticated;

-- Add items_gst_rate to invoices if not exists (for GST analysis)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'items_gst_rate'
  ) THEN
    ALTER TABLE invoices ADD COLUMN items_gst_rate numeric(5,2) default 18;
  END IF;
END $$;
