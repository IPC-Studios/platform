-- 0033: Harden tenancy oracle and liveness checks.
-- Patch functions that previously skipped deleted_at/status/plan checks.

-- Fix oracle: hide tenants for inactive/deleted/expired-plan users so RLS predicates go null.
create or replace function get_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.company_id from users u
  where u.user_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
    and is_company_plan_active(u.company_id)
$$;

-- get_auth_context now returns nothing for inactive/deleted users so middleware 403s instead of 200.
-- Signature matches 0023 (12 columns).
drop function if exists get_auth_context();
create or replace function get_auth_context()
returns table (
  company_id          uuid,
  role                app_role,
  is_owner            boolean,
  is_platform_admin   boolean,
  display_name        text,
  email               text,
  plan_expiry         timestamptz,
  plan_gate           text,
  profile_key         text,
  overrides           jsonb,
  password_changed_at timestamptz,
  password_version    integer
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
    exists (select 1 from platform_admins pa where pa.user_id = u.user_id) as is_platform_admin,
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
    ), '[]'::jsonb)               as overrides,
    au.password_changed_at,
    au.password_version
  from users u
  join companies c on c.id = u.company_id
  join auth.users au on au.id = u.user_id
  where u.user_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
$$;

-- Refresh rotation must not keep dead sessions alive. Add liveness gate after atomic claim.
create or replace function rotate_refresh_token(p_raw text)
returns table (user_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash    text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_row     refresh_tokens%rowtype;
  v_new_raw text;
begin
  update refresh_tokens
     set consumed_at = now()
   where token_hash = v_hash
     and consumed_at is null
     and revoked_at is null
     and expires_at > now()
   returning * into v_row;

  if not found then
    select * into v_row from refresh_tokens where token_hash = v_hash;
    if v_row.id is not null
       and v_row.consumed_at is not null
       and v_row.revoked_at is null
       and v_row.consumed_at < now() - interval '60 seconds'
    then
      update refresh_tokens set revoked_at = now()
        where family_id = v_row.family_id and revoked_at is null;
    end if;
    return query select null::uuid, null::text;
    return;
  end if;

  -- liveness: token owner must still be active+plan-live, otherwise revoke family
  if not exists (
    select 1 from users u where u.user_id = v_row.user_id and u.deleted_at is null and u.status='active' and is_company_plan_active(u.company_id)
  ) then
    update refresh_tokens set revoked_at = now() where family_id = v_row.family_id and revoked_at is null;
    return query select null::uuid, null::text;
    return;
  end if;

  v_new_raw := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    v_row.user_id,
    v_row.family_id,
    encode(sha256(convert_to(v_new_raw, 'UTF8')), 'hex'),
    v_row.expires_at
  );

  return query select v_row.user_id, v_new_raw;
end;
$$;

revoke all on function get_current_company_id() from public, anon;
revoke all on function get_auth_context() from public, anon;
grant execute on function get_current_company_id() to authenticated;
grant execute on function get_auth_context() to authenticated;
-- rotate_refresh_token remains service_role only (0025 revokes), no grant change
