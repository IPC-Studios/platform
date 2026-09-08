-- Same gap as company expenses (0064): gst_treatment could be set but there
-- was nowhere to record the actual rate, so input tax credit had nothing
-- real to read for a personal expense either.
alter table personal_expense add column if not exists gst_rate numeric(5, 2);

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
           pe.amount, pe.expense_date, pe.category, pe.gst_treatment, pe.gst_rate,
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
