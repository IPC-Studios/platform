-- A pending payment is not money received.
--
-- `received_payments.status` has been ('paid','pending') since 0106, and the
-- payments screen calls the second one "what is still pending" -- a client has
-- said they will pay, not that they have. Nothing that counted money ever
-- filtered on it. So a pending row inflated:
--
--   project_financials.received        the project's "Amount received", and
--                                      therefore its balance pending
--   monthly_profit_summary             the month's cash received, its net and
--                                      its margin
--   gopo_summary                       total income, the transaction feed, and
--                                      "has no payments recorded"
--   project_profitability_report       paid_income on every row
--   gst_analysis                       total income
--   get_quotation_for_token            what the CLIENT reads as received, and
--                                      the balance they are asked for
--   get_receipt_for_token              the running total printed on a receipt
--
-- The last two are the ones that leave the building: a client could be shown a
-- balance reduced by money they had not sent.
--
-- Every definition below is its current text copied byte-for-byte out of the
-- migration that owns it, with one predicate added and nothing else touched --
-- transcribing financial SQL by hand is how a digit goes missing. The
-- generator asserted each replacement matched before writing.
--
-- `= 'paid'` rather than `<> 'pending'` deliberately. They are identical today
-- (the column is NOT NULL and checked to exactly those two values), but if a
-- third status is ever added, understating money is visible and overstating it
-- is silent. A test pins the constraint so adding one fails loudly and sends
-- whoever adds it back to this list.
--
-- One reference is deliberately left alone: get_receipt_for_token's own
-- `where rp.id = v_payment` looks up the single payment the receipt is FOR.
-- A receipt for a pending payment should still render; it is the running
-- project total beside it that must not count money nobody has.

-- project_financials — copied from 0070_overhead_allocation.sql, one predicate added.
create or replace view project_financials
with (security_invoker = on) as
select
  p.id         as project_id,
  p.company_id,
  p.name,
  p.total_cost as revenue,
  coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and rp.status = 'paid'), 0) as received,
  coalesce((
    select sum(coalesce(s.final_cost, s.estimated_cost))
    from team_assignment_slots s
    where s.shoot_id in (select id from shoots where project_id = p.id)
      and s.status not in ('cancelled', 'released')
  ), 0) as direct_team_cost,
  coalesce((select sum(e.amount) from expenses e where e.project_id = p.id), 0)
    + case when p.status = 'cancelled' then 0 else
      coalesce(
        (select sum(e.amount) from expenses e
          where e.company_id = p.company_id and e.project_id is null and e.is_fixed_overhead)
        / nullif((
            select count(*) from projects p2
             where p2.company_id = p.company_id and p2.status <> 'cancelled'
          ), 0),
        0
      ) end as project_expenses
from projects p;

-- monthly_profit_summary — copied from 0118_fixed_overheads.sql, one predicate added.
create or replace function monthly_profit_summary(p_month date, p_basis text default 'cash', p_alloc text default 'equal')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_cash numeric := 0; v_booked numeric := 0;
  v_salary numeric := 0; v_fixed numeric := 0; v_variable numeric := 0;
begin
  select coalesce(sum(amount), 0) into v_cash from received_payments
   where company_id = v_company and paid_on >= v_start and paid_on < v_end
     and status = 'paid';
  select coalesce(sum(total_cost), 0) into v_booked from projects
   where company_id = v_company and created_at >= v_start and created_at < v_end;
  select coalesce(sum(amount), 0) into v_salary from team_payouts
   where company_id = v_company and created_at >= v_start and created_at < v_end;
  if to_regclass('public.fixed_overheads') is not null then
    select coalesce(sum(amount), 0) into v_fixed from fixed_overheads
     where company_id = v_company and month = v_start and is_active;
  end if;
  select coalesce(sum(amount), 0) into v_variable from expenses
   where company_id = v_company and expense_date >= v_start and expense_date < v_end
     and coalesce(is_fixed_overhead, false) = false;
  return jsonb_build_object(
    'month', v_start, 'basis', p_basis, 'alloc', p_alloc,
    'cash_received', v_cash, 'booked_revenue', v_booked,
    'salary_cost', v_salary, 'office_fixed', v_fixed, 'variable_cost', v_variable,
    'fixed_total', v_salary + v_fixed,
    'total_cost', v_salary + v_fixed + v_variable,
    'net_cash', v_cash - (v_salary + v_fixed + v_variable),
    'net_booked', v_booked - (v_salary + v_fixed + v_variable)
  );
end;
$$;

-- gopo_summary — copied from 0064_gopo_gst_fixes.sql, one predicate added.
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
            left join received_payments rp on rp.project_id = p.id and rp.status = 'paid'
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
         where rp.company_id = v_company and rp.status = 'paid'
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

-- project_profitability_report — copied from 0086_project_profitability_report.sql, one predicate added.
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
           where rp.project_id = p.id and rp.status = 'paid'
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

-- gst_analysis — copied from 0092_gst_analysis_state_name.sql, one predicate added.
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
       where rp.company_id = v_company and rp.paid_on between p_start_date and p_end_date
         and rp.status = 'paid'), 0)::numeric,
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

-- get_quotation_for_token — copied from 0126_client_documents_repair.sql, one predicate added.
create or replace function get_quotation_for_token(p_raw text)
returns table (
  snapshot jsonb, notes text, accepted_at timestamptz, accepted_by_name text,
  declined_at timestamptz, client_name text, company_name text,
  logo_url text, company_phone text, company_email text, company_address text, gstin text,
  shoots_schedule jsonb, terms_text text, display_prefs jsonb,
  show_quotation boolean, expires_at timestamptz, revoked boolean, access_count int,
  -- document extras
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  project_name text, project_status text,
  quotation_number text, issued_at timestamptz, quotation_id uuid,
  deliverables jsonb, deliverables_2 jsonb,
  total_received numeric, balance_due numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_quote uuid;
begin
  select at.subject_id into v_quote from access_tokens at
   where at.purpose = 'quotation'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_quote is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'quotation' and at.token_hash = v_hash;
  update project_quotations q set access_count = coalesce(q.access_count, 0) + 1
   where q.id = v_quote;

  return query
  select q.snapshot, q.notes, q.accepted_at, q.accepted_by_name, q.declined_at,
         cl.name, coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address, co.invoice_gst_number,
         coalesce(q.shoots_schedule, '[]'::jsonb), q.terms_text,
         coalesce(q.display_prefs, '{}'::jsonb),
         coalesce(q.show_quotation, true), q.expires_at,
         (q.revoked_at is not null),
         coalesce(q.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         p.name, p.status,
         -- Human-readable and stable: the studio's prefix plus the quote's own id.
         coalesce(co.quote_number_prefix, 'Q-') || upper(substring(q.id::text, 1, 8)),
         q.created_at, q.id,
         -- The real rows, so the document can show estimated dates and which
         -- items carry an extra charge rather than a flat "Included".
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title, 'description', d.description,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key = 'primary'
              and coalesce(d.show_on_quotation, true)), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title, 'description', d.description,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key <> 'primary'
              and coalesce(d.show_on_quotation, true)), '[]'::jsonb),
         coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id and x.status = 'paid'), 0),
         greatest(coalesce(p.total_cost, 0)
                  - coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id and x.status = 'paid'), 0), 0)
    from project_quotations q
    join projects p on p.id = q.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = q.company_id
   where q.id = v_quote
     and q.revoked_at is null
     and (q.expires_at is null or q.expires_at > now());
end;
$$;

-- get_receipt_for_token — copied from 0126_client_documents_repair.sql, one predicate added.
create or replace function get_receipt_for_token(p_raw text)
returns table (
  amount numeric, paid_on date, mode text, reference text,
  project_name text, client_name text, company_name text,
  total_cost numeric, received_total numeric,
  logo_url text, gstin text, company_phone text, company_email text, company_address text,
  description text, status text, access_count int, revoked boolean, expires_at timestamptz,
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  receipt_number text, is_gst boolean, payment_gst_number text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_payment uuid;
  v_expires timestamptz;
  v_count int;
begin
  select at.subject_id, at.expires_at, coalesce(at.access_count, 0)
    into v_payment, v_expires, v_count
    from access_tokens at
   where at.purpose = 'receipt'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_payment is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'receipt' and at.token_hash = v_hash;

  return query
  select rp.amount, coalesce(rp.date_received, rp.paid_on), rp.mode, rp.reference,
         p.name, cl.name, coalesce(co.display_name, co.name), p.total_cost,
         (select coalesce(sum(x.amount), 0) from received_payments x where x.project_id = p.id and x.status = 'paid'),
         coalesce(co.invoice_logo_url, co.avatar_url), co.invoice_gst_number,
         co.invoice_phone, co.invoice_email, co.invoice_address,
         coalesce(rp.description, rp.notes), coalesce(rp.status, 'paid'),
         v_count + 1, false, v_expires,
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         'R-' || upper(substring(rp.id::text, 1, 8)),
         coalesce(rp.is_gst, false), rp.gst_number
    from received_payments rp
    join projects p on p.id = rp.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = rp.company_id
   where rp.id = v_payment;
end;
$$;
