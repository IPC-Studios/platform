-- Phase 1: identity/tenancy functions.
-- All are SECURITY DEFINER + fixed search_path. auth.uid() reads the caller's
-- JWT regardless of definer, so tenancy is always derived server-side.

-- ── Tenancy resolvers (used by RLS policies AND get_auth_context) ──
create or replace function get_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from users where user_id = auth.uid()
$$;

create or replace function current_app_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from users where user_id = auth.uid()
$$;

create or replace function is_company_plan_active(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from companies c
    where c.id = p_company_id
      and greatest(
        coalesce(c.plan_expiry,         'epoch'::timestamptz),
        coalesce(c.grandfathered_until, 'epoch'::timestamptz),
        coalesce(c.grace_until,         'epoch'::timestamptz)
      ) > now()
  )
$$;

-- The current user is usable: row exists, not soft-deleted, status active,
-- and their company's plan is live. This is the load-bearing RLS predicate.
create or replace function is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from users u
    where u.user_id = auth.uid()
      and u.deleted_at is null
      and u.status = 'active'
      and is_company_plan_active(u.company_id)
  )
$$;

create or replace function is_current_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from companies c
    where c.id = get_current_company_id()
      and c.owner_user_id = auth.uid()
  )
$$;

-- ── get_auth_context — the single call the API auth middleware makes ──
-- Returns the caller's tenant + role + effective-access inputs. profile_key /
-- overrides stay null/[] until Phase 2 adds the access tables.
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
    null::text                    as profile_key,
    '[]'::jsonb                   as overrides
  from users u
  join companies c on c.id = u.company_id
  where u.user_id = auth.uid()
$$;

-- ── register_company_and_admin — atomic studio creation ──────
-- The user signs up through Supabase Auth first, then calls this once. It
-- creates the company + the owner's `users` row in one transaction. Idempotent
-- on the auth uid: a second call returns the existing tenant unchanged.
create or replace function register_company_and_admin(
  p_company_name text,
  p_admin_name   text,
  p_phone        text default null
)
returns table (company_id uuid, user_id uuid, role app_role, existing boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Idempotency: already registered → return current tenant.
  select u.company_id into v_company from users u where u.user_id = v_uid;
  if found then
    return query
      select u.company_id, u.user_id, u.role, true
      from users u where u.user_id = v_uid;
    return;
  end if;

  select au.email into v_email from auth.users au where au.id = v_uid;

  insert into companies (name, owner_user_id, display_name)
    values (p_company_name, v_uid, p_company_name)
    returning id into v_company;

  insert into users (user_id, company_id, role, name, email, phone, status)
    values (v_uid, v_company, 'super_admin', p_admin_name, coalesce(v_email, ''), p_phone, 'active');

  return query
    select v_company, v_uid, 'super_admin'::app_role, false;
end;
$$;

-- ── Grants: only authenticated callers; anon gets nothing ─────
revoke all on function get_auth_context()                          from public, anon;
revoke all on function register_company_and_admin(text, text, text) from public, anon;
grant execute on function get_auth_context()                          to authenticated;
grant execute on function register_company_and_admin(text, text, text) to authenticated;
