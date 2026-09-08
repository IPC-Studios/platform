-- Personal expenses: extend the existing table with updated_at and create an RPC
-- for listing with summary. The table already exists from 0012; we just add the
-- missing pieces.
alter table personal_expense
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists personal_expense_set_updated_at on personal_expense;
create trigger personal_expense_set_updated_at before update on personal_expense
  for each row execute function set_updated_at();

-- Index for date-range queries (reports)
create index if not exists personal_expense_date_idx
  on personal_expense (company_id, user_id, expense_date desc);

-- RPC: list personal expenses with summary for the current user
create or replace function list_personal_expenses(
  p_search   text default null,
  p_category text default null,
  p_cursor   timestamptz default null,
  p_limit    int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_user    uuid := auth.uid();
  v_limit   int  := greatest(1, least(p_limit, 200));
  v_items   jsonb;
  v_summary jsonb;
  v_next    timestamptz;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(pe)) into v_items
  from (
    select pe.id, pe.company_id, pe.user_id, pe.party_id,
           pa.name as party_name,
           pe.amount, pe.expense_date, pe.category, pe.gst_treatment,
           pe.description, pe.created_at
      from personal_expense pe
      left join parties pa on pa.id = pe.party_id
     where pe.company_id = v_company
       and pe.user_id = v_user
       and (p_search is null or pe.description ilike '%' || p_search || '%')
       and (p_category is null or pe.category = p_category)
       and (p_cursor is null or pe.created_at < p_cursor)
     order by pe.created_at desc
     limit v_limit + 1
  ) pe;

  -- Get the cursor for next page
  if coalesce(jsonb_array_length(v_items), 0) > v_limit then
    v_items := v_items - (-1);
    v_next := (v_items->-1->>'created_at')::timestamptz;
  else
    v_next := null;
  end if;

  -- Summary: total count/amount and this month
  select jsonb_build_object(
    'total_count', count(*)::int,
    'total_amount', coalesce(sum(amount), 0)::numeric,
    'this_month_count', count(*) filter (where expense_date >= date_trunc('month', current_date))::int,
    'this_month_amount', coalesce(sum(amount) filter (where expense_date >= date_trunc('month', current_date)), 0)::numeric
  ) into v_summary
  from personal_expense
  where company_id = v_company and user_id = v_user;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary,
    'next_cursor', to_jsonb(v_next)
  );
end;
$$;

revoke all on function list_personal_expenses(text, text, timestamptz, int) from public, anon;
grant execute on function list_personal_expenses(text, text, timestamptz, int) to authenticated;

-- RPC: get personal expense report
create or replace function personal_expense_report(
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
  v_user    uuid := auth.uid();
  v_result  jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,
    'total_amount', coalesce(
      (select sum(amount) from personal_expense
        where company_id = v_company and user_id = v_user
          and expense_date between p_start_date and p_end_date), 0)::numeric,
    'by_category', (
      select coalesce(jsonb_agg(row_to_json(cat)), '[]'::jsonb)
      from (
        select category, sum(amount) as amount, count(*)::int as count
          from personal_expense
         where company_id = v_company and user_id = v_user
           and expense_date between p_start_date and p_end_date
         group by category
         order by sum(amount) desc
      ) cat
    ),
    'daily_breakdown', (
      select coalesce(jsonb_agg(row_to_json(day)), '[]'::jsonb)
      from (
        select expense_date as date, sum(amount) as amount, count(*)::int as count
          from personal_expense
         where company_id = v_company and user_id = v_user
           and expense_date between p_start_date and p_end_date
         group by expense_date
         order by expense_date
      ) day
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function personal_expense_report(date, date) from public, anon;
grant execute on function personal_expense_report(date, date) to authenticated;
