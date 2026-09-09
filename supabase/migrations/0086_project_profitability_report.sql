-- Project-level profitability report ("Calculated Expenses" in the original):
-- per-project value, income received, receivables, project-linked +
-- allocated-overhead expense, gross profit/margin/collection, sortable and
-- paginated, with an optional date window.
--
-- Two deliberate departures from the original, not oversights:
--   1. The original split payments into paid/pending by a `status` column
--      on received_payments. This app's received_payments has no such
--      column -- every row already IS money received, recorded after the
--      fact, not a promised future payment -- so there is no
--      pending_income/total_received_income/pending_collection_rate to
--      compute; paid_income covers the whole concept here.
--   2. company_expense_total includes this project's share of company-wide
--      fixed-overhead expenses (the same allocation project_financials
--      already does, 0070), not just project-linked ones. The original's
--      report predates that feature and only ever summed project-linked
--      expenses; excluding overhead here would repeat the exact
--      "not a missing feature, a wrong number" mistake 0070 fixed for GOPO.
--
-- A date window (p_date_from/p_date_to) scopes payments and expenses only --
-- project_total_value is always the project's full value, matching the
-- original's own note that a filtered window still compares against the
-- whole booking, not a slice of it.
create or replace function project_profitability_report(
  p_date_from      date default null,
  p_date_to        date default null,
  p_project_id     uuid default null,
  p_client_id      uuid default null,
  p_status         text default null,
  p_search         text default null,
  p_sort_by        text default 'created_at',
  p_sort_direction text default 'desc',
  p_page           int  default 1,
  p_page_size      int  default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company    uuid := get_current_company_id();
  v_search     text := nullif(trim(coalesce(p_search, '')), '');
  v_sort_col   text;
  v_sort_dir   text := case when lower(coalesce(p_sort_direction, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_page       int  := greatest(1, coalesce(p_page, 1));
  v_page_size  int  := least(200, greatest(10, coalesce(p_page_size, 50)));
  v_base_sql   text;
  v_summary    jsonb;
  v_items      jsonb;
  v_total_count int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_sort_col := case p_sort_by
    when 'project_name' then 'project_name'
    when 'client_name' then 'client_name'
    when 'total_cost' then 'project_total_value'
    when 'paid_income' then 'paid_income'
    when 'receivables' then 'receivables'
    when 'company_expense_total' then 'company_expense_total'
    when 'gross_profit' then 'gross_profit'
    when 'gross_margin' then 'gross_margin'
    when 'collection_rate' then 'collection_rate'
    when 'status' then 'project_status'
    else 'created_at'
  end;

  -- $1 company, $2 date_from, $3 date_to, $4 project_id, $5 client_id, $6 status, $7 search
  v_base_sql := $sql$
    with active_count as (
      select count(*) as n from projects where company_id = $1 and status <> 'cancelled'
    ),
    base as (
      select
        p.id as project_id, p.name as project_name, p.client_id, c.name as client_name,
        p.status as project_status, p.created_at, p.total_cost as project_total_value,
        coalesce((
          select sum(rp.amount) from received_payments rp
           where rp.project_id = p.id
             and ($2::date is null or rp.paid_on >= $2) and ($3::date is null or rp.paid_on <= $3)
        ), 0) as paid_income,
        coalesce((
          select sum(e.amount) from expenses e
           where e.project_id = p.id
             and ($2::date is null or e.expense_date >= $2) and ($3::date is null or e.expense_date <= $3)
        ), 0)
        + case when p.status = 'cancelled' then 0 else
          coalesce((
            select sum(e.amount) from expenses e
             where e.company_id = p.company_id and e.project_id is null and e.is_fixed_overhead
               and ($2::date is null or e.expense_date >= $2) and ($3::date is null or e.expense_date <= $3)
          ) / nullif((select n from active_count), 0), 0)
        end as company_expense_total
      from projects p
      left join clients c on c.id = p.client_id
      where p.company_id = $1
        and ($4::uuid is null or p.id = $4)
        and ($5::uuid is null or p.client_id = $5)
        and ($6::text is null or p.status = $6)
        and ($7::text is null or p.name ilike '%' || $7 || '%' or c.name ilike '%' || $7 || '%')
    ),
    calc as (
      select *,
        (project_total_value - paid_income) as receivables,
        (paid_income - company_expense_total) as gross_profit,
        (project_total_value - company_expense_total) as expected_project_profit,
        case when paid_income > 0 then round(((paid_income - company_expense_total) / paid_income * 100)::numeric, 1) else 0 end as gross_margin,
        case when project_total_value > 0 then round(((project_total_value - company_expense_total) / project_total_value * 100)::numeric, 1) else 0 end as expected_margin,
        case when project_total_value > 0 then round((paid_income / project_total_value * 100)::numeric, 1) else 0 end as collection_rate,
        case when project_total_value > 0 then round((company_expense_total / project_total_value * 100)::numeric, 1) else 0 end as expense_ratio
      from base
    )
    select *,
      case when receivables > 0 then 'pending' when receivables < 0 then 'over_collected' else 'settled' end as balance_status,
      case when gross_profit < 0 then 'loss' when gross_margin < 20 then 'low_margin' when gross_margin < 50 then 'healthy' else 'strong' end as profitability_status,
      array_remove(array[
        case when paid_income = 0 then 'no_payments' end,
        case when receivables > 0 then 'pending_receivable' end,
        case when receivables < 0 then 'over_collected' end,
        case when expense_ratio >= 50 then 'high_expense_ratio' end,
        case when gross_profit >= 0 and paid_income > 0 and gross_margin < 20 then 'low_margin' end,
        case when gross_profit < 0 then 'loss_project' end,
        case when project_total_value = 0 then 'no_project_value' end,
        case when company_expense_total = 0 then 'no_linked_expenses' end
      ], null) as attention_flags
    from calc
  $sql$;

  execute format(
    $f$select jsonb_build_object(
      'project_count', count(*),
      'total_project_value', coalesce(sum(project_total_value), 0),
      'total_paid_income', coalesce(sum(paid_income), 0),
      'total_receivables', coalesce(sum(receivables), 0),
      'total_company_expenses', coalesce(sum(company_expense_total), 0),
      'total_gross_profit', coalesce(sum(gross_profit), 0),
      'average_gross_margin', coalesce(round(avg(gross_margin)::numeric, 1), 0),
      'average_collection_rate', coalesce(round(avg(collection_rate)::numeric, 1), 0),
      'loss_project_count', count(*) filter (where profitability_status = 'loss'),
      'pending_project_count', count(*) filter (where balance_status = 'pending'),
      'over_collected_project_count', count(*) filter (where balance_status = 'over_collected')
    ) from (%s) s$f$,
    v_base_sql
  ) into v_summary using v_company, p_date_from, p_date_to, p_project_id, p_client_id, p_status, v_search;

  v_total_count := (v_summary->>'project_count')::int;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) base_q order by %I %s nulls last limit $8 offset $9) t',
    v_base_sql, v_sort_col, v_sort_dir
  ) into v_items using v_company, p_date_from, p_date_to, p_project_id, p_client_id, p_status, v_search, v_page_size, (v_page - 1) * v_page_size;

  return jsonb_build_object(
    'summary', v_summary,
    'items', v_items,
    'pagination', jsonb_build_object(
      'page', v_page,
      'page_size', v_page_size,
      'total_count', v_total_count,
      'total_pages', greatest(1, ceil(v_total_count::numeric / v_page_size))
    )
  );
end;
$$;

revoke all on function project_profitability_report(date, date, uuid, uuid, text, text, text, text, int, int) from public, anon;
grant execute on function project_profitability_report(date, date, uuid, uuid, text, text, text, text, int, int) to authenticated;
