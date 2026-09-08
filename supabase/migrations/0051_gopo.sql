-- GOPO (Get Out Profit Out) dashboard: computes cash flow health, expense
-- breakdown, project performance, and attention items in a single RPC call.
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
      'total_revenue', coalesce(pf.total_revenue, 0),
      'total_received', coalesce(pf.total_received, 0),
      'total_expenses', coalesce(pf.total_expenses, 0),
      'total_direct_team_cost', coalesce(pf.total_direct_team_cost, 0),
      'net_profit', coalesce(pf.total_revenue, 0) - coalesce(pf.total_direct_team_cost, 0) - coalesce(pf.total_expenses, 0),
      'collection_rate', case when coalesce(pf.total_revenue, 0) > 0
        then round((coalesce(pf.total_received, 0) / pf.total_revenue * 100)::numeric, 1) else 0 end,
      'profit_margin', case when coalesce(pf.total_revenue, 0) > 0
        then round(((coalesce(pf.total_revenue, 0) - coalesce(pf.total_direct_team_cost, 0) - coalesce(pf.total_expenses, 0)) / pf.total_revenue * 100)::numeric, 1) else 0 end,
      'outstanding_balance', greatest(0, coalesce(pf.total_revenue, 0) - coalesce(pf.total_received, 0))
    ),
    'expense_breakdown', (
      select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb)
      from (
        select coalesce(category, 'uncategorized') as category,
               sum(amount) as amount,
               count(*)::int as count,
               case when sum(amount) over () > 0
                 then round((sum(amount) / sum(amount) over () * 100)::numeric, 1) else 0 end as percentage
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
        select 'no_payment' as kind,
               'warning' as severity,
               p.name || ' has no payments recorded' as message,
               p.id as project_id,
               p.name as project_name,
               p.total_cost as amount
          from projects p
          left join received_payments rp on rp.project_id = p.id
         where p.company_id = v_company and p.status = 'active' and rp.id is null
         order by p.total_cost desc
         limit 5
      ) a
      union all
      (
        select 'negative_profit' as kind,
               'critical' as severity,
               pf.name || ' is running at a loss' as message,
               pf.project_id,
               pf.name as project_name,
               (pf.revenue - pf.direct_team_cost - pf.project_expenses) as amount
          from project_financials pf
         where pf.company_id = v_company
           and (pf.revenue - pf.direct_team_cost - pf.project_expenses) < 0
         order by (pf.revenue - pf.direct_team_cost - pf.project_expenses) asc
         limit 5
      )
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
  ) into v_result;

  -- Compute health score from the collected data
  declare
    v_revenue numeric := (v_result->'score_card'->>'total_revenue')::numeric;
    v_received numeric := (v_result->'score_card'->>'total_received')::numeric;
    v_expenses numeric := (v_result->'score_card'->>'total_expenses')::numeric;
    v_team_cost numeric := (v_result->'score_card'->>'total_direct_team_cost')::numeric;
    v_net numeric := v_revenue - v_team_cost - v_expenses;
    v_coll_rate numeric := case when v_revenue > 0 then (v_received / v_revenue * 100) else 0 end;
    v_profit_margin numeric := case when v_revenue > 0 then (v_net / v_revenue * 100) else 0 end;
    v_score numeric := v_coll_rate * 0.5 + v_profit_margin * 0.5;
    v_label text;
  begin
    if v_score >= 80 then v_label := 'excellent';
    elsif v_score >= 60 then v_label := 'good';
    elsif v_score >= 40 then v_label := 'fair';
    elsif v_score >= 20 then v_label := 'poor';
    else v_label := 'critical';
    end if;
    v_result := jsonb_set(v_result, '{score_card,health_score}', to_jsonb(round(v_score, 1)));
    v_result := jsonb_set(v_result, '{score_card,health_label}', to_jsonb(v_label));
  end;

  return v_result;
end;
$$;

revoke all on function gopo_summary() from public, anon;
grant execute on function gopo_summary() to authenticated;
