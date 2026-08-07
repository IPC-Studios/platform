-- Phase 2: per-user access. A user's effective permissions =
--   owner? everything
--   else assigned profile (one active) UNION/MINUS overrides
--   else role defaults
-- The composition itself lives in @ipc/permissions (one source, both sides).
-- These tables just persist the inputs; get_auth_context feeds them to the API.

-- ── assignments: at most one active profile per user ──────────
create table user_access_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  user_id      uuid not null references users (user_id) on delete cascade,
  profile_key  text not null,
  access_level text,
  is_active    boolean not null default true,
  assigned_by  uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index uaa_one_active_per_user
  on user_access_assignments (user_id) where is_active;
create index uaa_company_idx on user_access_assignments (company_id);
create trigger uaa_set_updated_at before update on user_access_assignments
  for each row execute function set_updated_at();

-- ── overrides: per-permission on/off, layered on the profile ──
create table user_access_overrides (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  user_id        uuid not null references users (user_id) on delete cascade,
  permission_key text not null,   -- module key OR "module.action"
  enabled        boolean not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, permission_key)
);
create index uao_company_idx on user_access_overrides (company_id);
create trigger uao_set_updated_at before update on user_access_overrides
  for each row execute function set_updated_at();

-- ── audit trail ───────────────────────────────────────────────
create table access_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  target_user_id uuid not null,
  actor_user_id  uuid,
  action         text not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index aal_company_target_idx on access_audit_logs (company_id, target_user_id);

-- ── get_auth_context now feeds real profile + overrides ───────
create or replace function get_auth_context()
returns table (
  company_id   uuid,
  role         app_role,
  is_owner     boolean,
  display_name text,
  email        text,
  plan_expiry  timestamptz,
  plan_gate    text,
  profile_key  text,
  overrides    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.company_id,
    u.role,
    (c.owner_user_id = u.user_id) as is_owner,
    u.name                        as display_name,
    u.email,
    c.plan_expiry,
    case
      when coalesce(c.plan_expiry,         'epoch'::timestamptz) > now() then 'active'
      when coalesce(c.grandfathered_until, 'epoch'::timestamptz) > now() then 'grandfathered'
      when coalesce(c.grace_until,         'epoch'::timestamptz) > now() then 'grace'
      else 'expired'
    end                           as plan_gate,
    (
      select a.profile_key from user_access_assignments a
      where a.user_id = u.user_id and a.is_active
      limit 1
    )                             as profile_key,
    coalesce((
      select jsonb_agg(jsonb_build_object('permission_key', o.permission_key, 'enabled', o.enabled))
      from user_access_overrides o where o.user_id = u.user_id
    ), '[]'::jsonb)               as overrides
  from users u
  join companies c on c.id = u.company_id
  where u.user_id = auth.uid()
$$;

-- ── set_user_access — atomic assign profile + replace overrides + audit ──
-- Owner-only. Runs in one transaction. Pass profile_key = null to clear the
-- profile (fall back to role defaults). `p_overrides` is a jsonb array of
-- {permission_key, enabled}; it fully replaces the target's overrides.
create or replace function set_user_access(
  p_target_user_id uuid,
  p_profile_key    text,
  p_overrides      jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_company uuid := get_current_company_id();
begin
  if not is_current_owner() then
    raise exception 'only the studio owner can manage access' using errcode = '42501';
  end if;
  -- Target must belong to the same tenant.
  if not exists (select 1 from users where user_id = p_target_user_id and company_id = v_company) then
    raise exception 'target user is not in this studio' using errcode = '42501';
  end if;

  -- Deactivate any existing profile, then set the new one (if provided).
  update user_access_assignments
    set is_active = false, updated_at = now()
    where user_id = p_target_user_id and is_active;

  if p_profile_key is not null then
    insert into user_access_assignments (company_id, user_id, profile_key, is_active, assigned_by)
      values (v_company, p_target_user_id, p_profile_key, true, v_actor);
  end if;

  -- Replace overrides wholesale.
  delete from user_access_overrides where user_id = p_target_user_id;
  insert into user_access_overrides (company_id, user_id, permission_key, enabled)
    select v_company, p_target_user_id, (e ->> 'permission_key'), (e ->> 'enabled')::boolean
    from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) as e
    where (e ->> 'permission_key') is not null;

  insert into access_audit_logs (company_id, target_user_id, actor_user_id, action, detail)
    values (v_company, p_target_user_id, v_actor, 'set_user_access',
            jsonb_build_object('profile_key', p_profile_key, 'overrides', p_overrides));
end;
$$;

create or replace function get_user_access(p_target_user_id uuid)
returns table (profile_key text, overrides jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select a.profile_key from user_access_assignments a
       where a.user_id = p_target_user_id and a.is_active limit 1),
    coalesce((
      select jsonb_agg(jsonb_build_object('permission_key', o.permission_key, 'enabled', o.enabled))
      from user_access_overrides o where o.user_id = p_target_user_id
    ), '[]'::jsonb)
  where exists (
    select 1 from users
    where user_id = p_target_user_id and company_id = get_current_company_id()
  )
$$;

-- ── RLS ───────────────────────────────────────────────────────
alter table user_access_assignments enable row level security;
alter table user_access_overrides   enable row level security;
alter table access_audit_logs        enable row level security;

create policy uaa_select on user_access_assignments
  for select to authenticated using (company_id = get_current_company_id());
create policy uao_select on user_access_overrides
  for select to authenticated using (company_id = get_current_company_id());
create policy aal_select_owner on access_audit_logs
  for select to authenticated using (company_id = get_current_company_id() and is_current_owner());
-- Writes go only through set_user_access (SECURITY DEFINER) — no direct policies.

-- ── Grants ────────────────────────────────────────────────────
revoke all on function set_user_access(uuid, text, jsonb) from public, anon;
revoke all on function get_user_access(uuid)              from public, anon;
grant execute on function set_user_access(uuid, text, jsonb) to authenticated;
grant execute on function get_user_access(uuid)              to authenticated;
