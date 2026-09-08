-- Project templates: reusable configurations for quick project setup.
create table if not exists project_templates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  name              text not null,
  description       text,
  deliverables_json jsonb not null default '[]'::jsonb,
  shoots_json       jsonb not null default '[]'::jsonb,
  tasks_json        jsonb not null default '[]'::jsonb,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index project_templates_company_idx on project_templates (company_id);
drop trigger if exists project_templates_set_updated_at on project_templates;
create trigger project_templates_set_updated_at before update on project_templates
  for each row execute function set_updated_at();

alter table project_templates enable row level security;
drop policy if exists project_templates_select on project_templates;
drop policy if exists project_templates_write on project_templates;
create policy project_templates_select on project_templates for select to authenticated
  using (company_id = get_current_company_id());
create policy project_templates_write on project_templates for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- RPC: create a project template
create or replace function create_project_template(
  p_name              text,
  p_description       text default null,
  p_deliverables_json jsonb default '[]'::jsonb,
  p_shoots_json       jsonb default '[]'::jsonb,
  p_tasks_json        jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into project_templates (company_id, name, description, deliverables_json, shoots_json, tasks_json, created_by)
  values (v_company, p_name, p_description, p_deliverables_json, p_shoots_json, p_tasks_json, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function create_project_template(text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function create_project_template(text, text, jsonb, jsonb, jsonb) to authenticated;

-- RPC: create a project from template
create or replace function create_project_from_template(
  p_template_id uuid,
  p_name        text,
  p_client_id   uuid default null,
  p_start_date  date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_template project_templates;
  v_project  uuid;
  v_deliverable jsonb;
  v_shoot    jsonb;
  v_task     jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_template from project_templates
   where id = p_template_id and company_id = v_company;
  if v_template.id is null then
    raise exception 'template not found' using errcode = 'P0001';
  end if;

  -- Create the project
  insert into projects (company_id, name, client_id, start_date, status)
  values (v_company, p_name, p_client_id, p_start_date, 'active')
  returning id into v_project;

  -- Create deliverables from template
  for v_deliverable in select * from jsonb_array_elements(v_template.deliverables_json)
  loop
    insert into deliverables (company_id, project_id, name, description, quantity, sort_order)
    values (
      v_company, v_project,
      v_deliverable->>'name',
      v_deliverable->>'description',
      coalesce((v_deliverable->>'quantity')::int, 1),
      coalesce((v_deliverable->>'sort_order')::int, 0)
    );
  end loop;

  -- Create shoots from template
  for v_shoot in select * from jsonb_array_elements(v_template.shoots_json)
  loop
    insert into shoots (company_id, project_id, name, kind, status)
    values (
      v_company, v_project,
      v_shoot->>'name',
      v_shoot->>'kind',
      'planned'
    );
  end loop;

  -- Create tasks from template
  for v_task in select * from jsonb_array_elements(v_template.tasks_json)
  loop
    insert into tasks (company_id, project_id, title, priority, sort_order, status)
    values (
      v_company, v_project,
      v_task->>'title',
      coalesce(v_task->>'priority', 'medium'),
      coalesce((v_task->>'sort_order')::int, 0),
      'todo'
    );
  end loop;

  return v_project;
end;
$$;

revoke all on function create_project_from_template(uuid, text, uuid, date) from public, anon;
grant execute on function create_project_from_template(uuid, text, uuid, date) to authenticated;
