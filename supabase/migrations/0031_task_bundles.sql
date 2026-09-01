-- Task bundles: a way to apply them, and a description on tasks.
--
-- The bundle tables have been there since 0007, correctly policied (read for
-- members, write for admin/manager) — what was missing was any way to reach
-- them: no endpoints, no UI, and no function to turn a checklist into tasks.

-- A task carried a title and nothing else. "Cull and select" means little to
-- whoever picks it up three weeks later without the rest of the sentence.
alter table tasks
  add column if not exists description text;

-- ── applying a bundle ─────────────────────────────────────────
-- A bundle is a checklist a studio repeats — wedding editing, album delivery.
-- Applying it stamps out one task per item, in order, optionally against a
-- project and assigned to whoever will do the work.
create or replace function apply_task_bundle(
  p_bundle_id  uuid,
  p_project_id uuid default null,
  p_assignees  uuid[] default '{}'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_item    task_bundle_items;
  v_task    uuid;
  v_count   int := 0;
  v_user    uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Scope the bundle to the caller's company: an id alone must not reach
  -- across tenants, SECURITY DEFINER having bypassed RLS to get here.
  if not exists (
    select 1 from task_bundles where id = p_bundle_id and company_id = v_company
  ) then
    raise exception 'unknown bundle' using errcode = '42501';
  end if;

  if p_project_id is not null and not exists (
    select 1 from projects where id = p_project_id and company_id = v_company
  ) then
    raise exception 'unknown project' using errcode = '42501';
  end if;

  for v_item in
    select * from task_bundle_items
    where bundle_id = p_bundle_id and company_id = v_company
    order by sort_order, title
  loop
    insert into tasks (company_id, project_id, title, priority, status, created_by)
    values (v_company, p_project_id, v_item.title, v_item.priority, 'to_do', auth.uid())
    returning id into v_task;

    foreach v_user in array coalesce(p_assignees, '{}')
    loop
      insert into task_assignees (task_id, user_id, company_id)
      values (v_task, v_user, v_company)
      on conflict do nothing;
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function apply_task_bundle(uuid, uuid, uuid[]) from public, anon;
grant execute on function apply_task_bundle(uuid, uuid, uuid[]) to authenticated;
