-- Phase 5: tasks & production. One deliverable_id FK (Fork 3, no deliverable_2_id).
-- Custom statuses/priorities per company collapse to a canonical enum
-- (mirrored by @ipc/domain). Board order persists drag-and-drop per view/lane.

-- ── helper: is the caller an admin/manager (or owner)? ────────
create or replace function is_current_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_app_role() in ('super_admin', 'admin', 'manager')
$$;

-- ── canonical enums ───────────────────────────────────────────
create type task_status as enum ('to_do', 'in_progress', 'completed', 'cancelled');
create type task_priority as enum ('low', 'medium', 'high', 'urgent');

-- ── custom status/priority catalogues ─────────────────────────
create table company_deliverable_statuses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  code          text not null,
  label         text not null,
  scope         text not null default 'both' check (scope in ('deliverable', 'task', 'both')),
  category      task_status not null default 'to_do',   -- canonical it maps to
  team_allowed  boolean not null default true,
  color         text,
  display_group text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (company_id, code)
);

create table company_task_priorities (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  code       text not null,
  label      text not null,
  tone       text,          -- drives the canonical priority (see @ipc/domain)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

-- ── tasks ─────────────────────────────────────────────────────
create table tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies (id) on delete cascade,
  project_id          uuid references projects (id) on delete cascade,
  deliverable_id      uuid references deliverables (id) on delete set null,
  parent_task_id      uuid references tasks (id) on delete set null,
  title               text not null,
  status              task_status not null default 'to_do',
  priority            task_priority not null default 'medium',
  custom_status_code  text,
  custom_priority_code text,
  due_date            date,
  voice_note_url      text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index tasks_company_status_created_idx on tasks (company_id, status, created_at desc);
create index tasks_project_idx on tasks (project_id);
create index tasks_deliverable_idx on tasks (deliverable_id);
create trigger tasks_set_updated_at before update on tasks
  for each row execute function set_updated_at();

create table task_assignees (
  task_id    uuid not null references tasks (id) on delete cascade,
  user_id    uuid not null references users (user_id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on task_assignees (user_id);

-- ── bundles (reusable task templates) ─────────────────────────
create table task_bundles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create table task_bundle_items (
  id         uuid primary key default gen_random_uuid(),
  bundle_id  uuid not null references task_bundles (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  title      text not null,
  priority   task_priority not null default 'medium',
  sort_order int not null default 0
);
create index tbi_bundle_idx on task_bundle_items (bundle_id, sort_order);

-- ── production board order (persisted drag-and-drop) ──────────
create table production_board_card_order (
  company_id uuid not null references companies (id) on delete cascade,
  board_view text not null default 'default',
  lane_key   text not null,
  task_id    uuid not null references tasks (id) on delete cascade,
  sort_order int not null default 0,
  primary key (company_id, board_view, task_id)
);
create index pbco_lane_idx on production_board_card_order (company_id, board_view, lane_key, sort_order);

-- ── RLS ───────────────────────────────────────────────────────
alter table company_deliverable_statuses enable row level security;
alter table company_task_priorities      enable row level security;
alter table tasks                        enable row level security;
alter table task_assignees               enable row level security;
alter table task_bundles                 enable row level security;
alter table task_bundle_items            enable row level security;
alter table production_board_card_order  enable row level security;

-- Catalogues + bundles + board order: read for members, write for admin/manager.
do $$
declare t text;
begin
  foreach t in array array[
    'company_deliverable_statuses','company_task_priorities',
    'task_bundles','task_bundle_items','production_board_card_order'
  ]
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = get_current_company_id() and is_current_admin_or_manager())
         with check (company_id = get_current_company_id() and is_current_admin_or_manager());', t, t);
  end loop;
end $$;

-- tasks: admins/managers see all; employees see only tasks assigned to them.
create policy tasks_select on tasks
  for select to authenticated
  using (
    company_id = get_current_company_id()
    and (
      is_current_admin_or_manager()
      or exists (select 1 from task_assignees a where a.task_id = tasks.id and a.user_id = auth.uid())
    )
  );
create policy tasks_write on tasks
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

create policy task_assignees_select on task_assignees
  for select to authenticated
  using (company_id = get_current_company_id());
create policy task_assignees_write on task_assignees
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

-- ── RPCs ──────────────────────────────────────────────────────
create or replace function create_task_with_assignees(
  p_project_id     uuid,
  p_deliverable_id uuid,
  p_title          text,
  p_status         task_status default 'to_do',
  p_priority       task_priority default 'medium',
  p_due_date       date default null,
  p_assignees      uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_task    uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into tasks (company_id, project_id, deliverable_id, title, status, priority, due_date, created_by)
    values (v_company, p_project_id, p_deliverable_id, p_title, p_status, p_priority, p_due_date, auth.uid())
    returning id into v_task;

  insert into task_assignees (task_id, user_id, company_id)
    select v_task, u, v_company from unnest(coalesce(p_assignees, '{}')) as u
    where exists (select 1 from users where user_id = u and company_id = v_company);

  return v_task;
end;
$$;

-- One task per deliverable of a project (skips deliverables that already have a
-- task). Returns the ids of tasks created.
create or replace function generate_tasks_for_project_deliverables(
  p_project_id uuid,
  p_assignees  uuid[] default '{}'
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_del     record;
  v_task    uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'project not in this studio' using errcode = '42501';
  end if;

  for v_del in
    select d.id, d.title from deliverables d
    where d.project_id = p_project_id
      and not exists (select 1 from tasks t where t.deliverable_id = d.id)
  loop
    insert into tasks (company_id, project_id, deliverable_id, title, created_by)
      values (v_company, p_project_id, v_del.id, v_del.title, auth.uid())
      returning id into v_task;
    insert into task_assignees (task_id, user_id, company_id)
      select v_task, u, v_company from unnest(coalesce(p_assignees, '{}')) as u
      where exists (select 1 from users where user_id = u and company_id = v_company);
    return next v_task;
  end loop;
end;
$$;

create or replace function apply_task_bundle_to_project(
  p_bundle_id       uuid,
  p_project_id      uuid,
  p_assignees       uuid[] default '{}',
  p_default_due_date date default null
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_item    record;
  v_task    uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for v_item in
    select title, priority from task_bundle_items
    where bundle_id = p_bundle_id and company_id = v_company
    order by sort_order
  loop
    insert into tasks (company_id, project_id, title, priority, due_date, created_by)
      values (v_company, p_project_id, v_item.title, v_item.priority, p_default_due_date, auth.uid())
      returning id into v_task;
    insert into task_assignees (task_id, user_id, company_id)
      select v_task, u, v_company from unnest(coalesce(p_assignees, '{}')) as u
      where exists (select 1 from users where user_id = u and company_id = v_company);
    return next v_task;
  end loop;
end;
$$;

-- Persist a lane's card order: task_ids in the desired order.
create or replace function set_board_lane_order(
  p_board_view text,
  p_lane_key   text,
  p_task_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
  v_idx     int := 0;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_task_ids, '{}') loop
    insert into production_board_card_order (company_id, board_view, lane_key, task_id, sort_order)
      values (v_company, p_board_view, p_lane_key, v_id, v_idx)
    on conflict (company_id, board_view, task_id)
      do update set lane_key = excluded.lane_key, sort_order = excluded.sort_order;
    v_idx := v_idx + 1;
  end loop;
end;
$$;

-- Employee-safe: update the status of a task assigned to me.
create or replace function update_my_task_status(p_task_id uuid, p_status task_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from task_assignees where task_id = p_task_id and user_id = auth.uid()
  ) then
    raise exception 'not your task' using errcode = '42501';
  end if;
  update tasks set status = p_status, updated_at = now() where id = p_task_id;
end;
$$;

revoke all on function create_task_with_assignees(uuid, uuid, text, task_status, task_priority, date, uuid[]) from public, anon;
revoke all on function generate_tasks_for_project_deliverables(uuid, uuid[]) from public, anon;
revoke all on function apply_task_bundle_to_project(uuid, uuid, uuid[], date) from public, anon;
revoke all on function set_board_lane_order(text, text, uuid[]) from public, anon;
revoke all on function update_my_task_status(uuid, task_status) from public, anon;
grant execute on function create_task_with_assignees(uuid, uuid, text, task_status, task_priority, date, uuid[]) to authenticated;
grant execute on function generate_tasks_for_project_deliverables(uuid, uuid[]) to authenticated;
grant execute on function apply_task_bundle_to_project(uuid, uuid, uuid[], date) to authenticated;
grant execute on function set_board_lane_order(text, text, uuid[]) to authenticated;
grant execute on function update_my_task_status(uuid, task_status) to authenticated;
