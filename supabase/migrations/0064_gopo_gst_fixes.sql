-- Repairs the two dashboard RPCs from 0051 and 0058. Both were created but
-- never executed: a plpgsql body is not checked until it runs, so those
-- migrations applied cleanly while every call raised. 0051-0063 are already
-- applied on the live database, so the fixes land here rather than in place.

-- Expense-side GST rate. 0058 computed input tax credit from expenses.gst_rate,
-- which has never existed -- expenses only record gst_treatment, not a rate.
-- Added at 0 so the figure stays honest until the expense form captures it.
alter table expenses add column if not exists gst_rate numeric(5, 2) not null default 0;

-- GOPO -----------------------------------------------------------------
-- Four faults, all fatal at call time:
--   1. score_card referenced `pf`, bound only inside the project_performance
--      subquery, so the statement had no FROM entry for it;
--   2. expense_breakdown used `sum(amount) over ()` beside `group by category`,
--      leaving a bare column neither grouped nor aggregated;
--   3. attention_items hung its `union all` off the outer aggregate, unioning
--      one column with six;
--   4. so the dashboard rendered blank.
create or replace function gopo_summary()
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
    'score_card', jsonb_build_object(
      'health_score', 0,
      'health_label', 'fair',
      'total_revenue', t.total_revenue,
      'total_received', t.total_received,
      'total_expenses', t.total_expenses,
      'total_direct_team_cost', t.total_direct_team_cost,
      'net_profit', t.total_revenue - t.total_direct_team_cost - t.total_expenses,
      'collection_rate', case when t.total_revenue > 0
        then round((t.total_received / t.total_revenue * 100)::numeric, 1) else 0 end,
      'profit_margin', case when t.total_revenue > 0
        then round(((t.total_revenue - t.total_direct_team_cost - t.total_expenses) / t.total_revenue * 100)::numeric, 1) else 0 end,
      'outstanding_balance', greatest(0, t.total_revenue - t.total_received)
    ),
    'expense_breakdown', (
      select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb)
      from (
        select coalesce(category, 'uncategorized') as category,
               sum(amount) as amount,
               count(*)::int as count,
               case when sum(sum(amount)) over () > 0
                 then round((sum(amount) / sum(sum(amount)) over () * 100)::numeric, 1) else 0 end as percentage
          from expenses
         where company_id = v_company
         group by category
         order by sum(amount) desc
      ) e
    ),
    'project_performance', (
      select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb)
      from (
        select pf.project_id, pf.name as project_name, pf.revenue, pf.received,
               pf.direct_team_cost, pf.project_expenses,
               pf.revenue - pf.direct_team_cost - pf.project_expenses as gross_profit,
               greatest(0, pf.revenue - pf.received) as balance_pending,
               case when pf.revenue > 0
                 then round(((pf.revenue - pf.direct_team_cost - pf.project_expenses) / pf.revenue * 100)::numeric, 1)
                 else 0 end as profit_margin,
               p.status
          from project_financials pf
          join projects p on p.id = pf.project_id
         where pf.company_id = v_company
         order by pf.revenue - pf.direct_team_cost - pf.project_expenses asc
      ) p
    ),
    'attention_items', (
      select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb)
      from (
        (
          select 'no_payment' as kind, 'warning' as severity,
                 p.name || ' has no payments recorded' as message,
                 p.id as project_id, p.name as project_name, p.total_cost as amount
            from projects p
            left join received_payments rp on rp.project_id = p.id
           where p.company_id = v_company and p.status = 'active' and rp.id is null
           order by p.total_cost desc
           limit 5
        )
        union all
        (
          select 'negative_profit' as kind, 'critical' as severity,
                 pf.name || ' is running at a loss' as message,
                 pf.project_id, pf.name as project_name,
                 (pf.revenue - pf.direct_team_cost - pf.project_expenses) as amount
            from project_financials pf
           where pf.company_id = v_company
             and (pf.revenue - pf.direct_team_cost - pf.project_expenses) < 0
           order by (pf.revenue - pf.direct_team_cost - pf.project_expenses) asc
           limit 5
        )
      ) a
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      from (
        select rp.paid_on as date,
               'Payment received from ' || coalesce(c.name, 'client') as description,
               rp.amount,
               'income' as type
          from received_payments rp
          join projects p on p.id = rp.project_id
          left join clients c on c.id = p.client_id
         where rp.company_id = v_company
         order by rp.paid_on desc
         limit 10
      ) r
    )
  ) into v_result
  from (
    select coalesce((select sum(revenue)          from project_financials where company_id = v_company), 0) as total_revenue,
           coalesce((select sum(received)         from project_financials where company_id = v_company), 0) as total_received,
           coalesce((select sum(direct_team_cost) from project_financials where company_id = v_company), 0) as total_direct_team_cost,
           coalesce((select sum(amount)           from expenses           where company_id = v_company), 0) as total_expenses
  ) t;

  declare
    v_revenue   numeric := (v_result->'score_card'->>'total_revenue')::numeric;
    v_received  numeric := (v_result->'score_card'->>'total_received')::numeric;
    v_expenses  numeric := (v_result->'score_card'->>'total_expenses')::numeric;
    v_team_cost numeric := (v_result->'score_card'->>'total_direct_team_cost')::numeric;
    v_net       numeric := v_revenue - v_team_cost - v_expenses;
    v_coll_rate numeric := case when v_revenue > 0 then (v_received / v_revenue * 100) else 0 end;
    v_margin    numeric := case when v_revenue > 0 then (v_net / v_revenue * 100) else 0 end;
    -- Clamped to 0..100: a loss-making studio produces a negative margin and an
    -- advance-heavy one a collection rate above 100, and the score is a 0-100
    -- gauge either way. The contract bounds it the same.
    v_score     numeric := least(100, greatest(0, v_coll_rate * 0.5 + v_margin * 0.5));
    v_label     text;
  begin
    if    v_score >= 80 then v_label := 'excellent';
    elsif v_score >= 60 then v_label := 'good';
    elsif v_score >= 40 then v_label := 'fair';
    elsif v_score >= 20 then v_label := 'poor';
    else                     v_label := 'critical';
    end if;
    v_result := jsonb_set(v_result, '{score_card,health_score}', to_jsonb(round(v_score, 1)));
    v_result := jsonb_set(v_result, '{score_card,health_label}', to_jsonb(v_label));
  end;

  return v_result;
end;
$$;
revoke all on function gopo_summary() from public, anon;
grant execute on function gopo_summary() to authenticated;

-- GST analysis ---------------------------------------------------------
-- 0058 read expenses.gst_rate (absent) and derived GST collected from
-- invoices.items_gst_rate -- a column it invented for itself, defaulting every
-- invoice to a flat 18%. invoice_items already carries the real per-line cgst,
-- sgst and igst, and the by_gst_rate breakdown was already reading them, so the
-- headline figure disagreed with the table beneath it. Both now use the same
-- source. reverse_charge was hard-coded to 0 and is computed here.
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
        select coalesce(i.place_of_supply, 'Unknown') as state,
               sum(ii.taxable) as income,
               sum(ii.cgst + ii.sgst + ii.igst) as gst
          from invoice_items ii join invoices i on i.id = ii.invoice_id
         where i.company_id = v_company and i.invoice_date between p_start_date and p_end_date
         group by i.place_of_supply
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
revoke all on function gst_analysis(date, date) from public, anon;
grant execute on function gst_analysis(date, date) to authenticated;
