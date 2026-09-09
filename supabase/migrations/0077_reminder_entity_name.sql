-- A reminder could be linked to a lead/project/client/invoice on the
-- backend since 0060, but list_reminders() never resolved a display
-- name for the linked record -- the UI had nothing to show for the link
-- but a raw type and a uuid, so it never built a picker for it either.
-- Resolve the name here once, so the list can show "Sharma Wedding
-- (project)" instead of nothing.
create or replace function list_reminders(
  p_status   text default null,
  p_priority text default null,
  p_user_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_items   jsonb;
  v_summary jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(r)) into v_items
  from (
    select rm.id, rm.company_id, rm.user_id, rm.title, rm.description, rm.priority, rm.status,
           rm.entity_type, rm.entity_id, rm.due_at, rm.created_at,
           case rm.entity_type
             when 'lead' then (select name from crm_leads where id = rm.entity_id)
             when 'project' then (select name from projects where id = rm.entity_id)
             when 'client' then (select name from clients where id = rm.entity_id)
             when 'invoice' then (select invoice_number from invoices where id = rm.entity_id)
             else null
           end as entity_name
      from reminders rm
     where rm.company_id = v_company
       and (p_status is null or rm.status = p_status)
       and (p_priority is null or rm.priority = p_priority)
       and (p_user_id is null or rm.user_id = p_user_id)
     order by
       case rm.priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
       rm.due_at nulls last,
       rm.created_at desc
  ) r;

  select jsonb_build_object(
    'total_count', count(*)::int,
    'active_count', count(*) filter (where status = 'active')::int,
    'overdue_count', count(*) filter (where status = 'active' and due_at < now())::int,
    'due_today_count', count(*) filter (where status = 'active' and due_at::date = current_date)::int
  ) into v_summary
  from reminders
  where company_id = v_company and (p_user_id is null or user_id = p_user_id);

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary
  );
end;
$$;
