-- Reminders system: dedicated reminders with entity linking and priority.
create table if not exists reminders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references users (user_id) on delete cascade,
  title         text not null,
  description   text,
  priority      text not null default 'medium'
                  check (priority in ('low', 'medium', 'high', 'urgent')),
  status        text not null default 'active'
                  check (status in ('active', 'completed', 'dismissed')),
  entity_type   text check (entity_type in ('lead', 'project', 'client', 'invoice', 'custom')),
  entity_id     uuid,
  due_at        timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index reminders_company_user_idx on reminders (company_id, user_id, status, due_at);
create index reminders_due_idx on reminders (company_id, due_at) where status = 'active';
drop trigger if exists reminders_set_updated_at on reminders;
create trigger reminders_set_updated_at before update on reminders
  for each row execute function set_updated_at();

alter table reminders enable row level security;
create policy reminders_select on reminders for select to authenticated
  using (company_id = get_current_company_id());
create policy reminders_write on reminders for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- RPC: list reminders with summary
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
  v_user    uuid := auth.uid();
  v_items   jsonb;
  v_summary jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(r)) into v_items
  from (
    select id, company_id, user_id, title, description, priority, status,
           entity_type, entity_id, due_at, created_at
      from reminders
     where company_id = v_company
       and (p_status is null or status = p_status)
       and (p_priority is null or priority = p_priority)
       and (p_user_id is null or user_id = p_user_id)
     order by
       case priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
       due_at nulls last,
       created_at desc
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

revoke all on function list_reminders(text, text, uuid) from public, anon;
grant execute on function list_reminders(text, text, uuid) to authenticated;
