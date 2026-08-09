-- Phase 14 follow-up: the cross-tenant platform console (the software vendor's
-- view, NOT a studio owner's). Access is the `platform_admins` allowlist only —
-- a studio owner (super_admin) must never see other tenants. Every reader here
-- is security-definer and hard-gated on is_platform_admin(); the definer context
-- is what lets these queries cross the tenant RLS boundary on purpose.
--
-- Seeding (no UI, intentionally): insert into platform_admins (user_id) values ('<auth uid>');

-- ── membership helper ─────────────────────────────────────────
create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- ── surface the flag in the one-shot auth context ─────────────
-- Adding a return column changes the signature, so replace-in-place is refused:
-- drop then recreate. Nothing in SQL depends on it (called only via RPC).
drop function if exists get_auth_context();
create or replace function get_auth_context()
returns table (
  company_id        uuid,
  role              app_role,
  is_owner          boolean,
  is_platform_admin boolean,
  display_name      text,
  email             text,
  plan_expiry       timestamptz,
  plan_gate         text,
  profile_key       text,
  overrides         jsonb
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
    ), '[]'::jsonb)               as overrides
  from users u
  join companies c on c.id = u.company_id
  where u.user_id = auth.uid()
$$;

-- Shared plan-gate expression (kept identical to get_auth_context).
create or replace function platform_plan_gate(
  p_expiry timestamptz, p_grandfathered timestamptz, p_grace timestamptz
) returns text
language sql
immutable
as $$
  select case
    when coalesce(p_expiry,        'epoch'::timestamptz) > now() then 'active'
    when coalesce(p_grandfathered, 'epoch'::timestamptz) > now() then 'grandfathered'
    when coalesce(p_grace,         'epoch'::timestamptz) > now() then 'grace'
    else 'expired'
  end
$$;

-- ── console: one row per studio ───────────────────────────────
create or replace function platform_list_studios()
returns table (
  id            uuid,
  name          text,
  owner_email   text,
  plan_gate     text,
  plan_expiry   timestamptz,
  user_count    bigint,
  project_count bigint,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  return query
    select
      c.id,
      c.name,
      owner.email,
      platform_plan_gate(c.plan_expiry, c.grandfathered_until, c.grace_until),
      c.plan_expiry,
      (select count(*) from users u where u.company_id = c.id and u.deleted_at is null),
      (select count(*) from projects p where p.company_id = c.id),
      c.created_at
    from companies c
    left join users owner on owner.user_id = c.owner_user_id
    order by c.created_at desc;
end;
$$;

-- ── console: platform-wide totals ─────────────────────────────
create or replace function platform_usage_summary()
returns table (
  studio_count         bigint,
  active_studio_count  bigint,
  total_users          bigint,
  revenue_last_30d     numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  return query
    select
      (select count(*) from companies),
      (select count(*) from companies c
         where platform_plan_gate(c.plan_expiry, c.grandfathered_until, c.grace_until)
               in ('active', 'grandfathered')),
      (select count(*) from users u where u.deleted_at is null),
      coalesce((select sum(amount) from payment_transactions
         where created_at > now() - interval '30 days'), 0);
end;
$$;

revoke all on function platform_list_studios()    from public, anon;
revoke all on function platform_usage_summary()   from public, anon;
grant execute on function is_platform_admin()     to authenticated;
grant execute on function platform_list_studios() to authenticated;
grant execute on function platform_usage_summary() to authenticated;
