-- Session invalidation by version, not by clock.
--
-- 0022 compared the token's `iat` against auth.users.password_changed_at. JWT
-- `iat` is whole seconds, so a session created in the SAME second as the reset
-- survived it (CI caught exactly that). A counter has no resolution to lose:
-- tokens carry the version they were minted with, and the API refuses any token
-- whose version no longer matches.
--
-- Tokens already in the wild carry no version claim and are read as 0, which
-- matches the default — so this does not log everyone out.

alter table auth.users
  add column if not exists password_version integer not null default 0;

create or replace function consume_password_reset(p_raw text, p_password_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update password_reset_tokens set consumed_at = now()
    where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
      and consumed_at is null
      and expires_at > now()
    returning user_id into v_user;
  if v_user is null then
    return null;
  end if;

  update auth.users
     set encrypted_password  = p_password_hash,
         password_changed_at = now(),
         password_version    = password_version + 1,
         email_verified      = true,
         email_verified_at   = coalesce(email_verified_at, now())
   where id = v_user;

  -- Any other outstanding reset link for this user dies with it.
  update password_reset_tokens set consumed_at = now()
    where user_id = v_user and consumed_at is null;

  return v_user;
end;
$$;

revoke all on function consume_password_reset(text, text) from public, anon;
grant execute on function consume_password_reset(text, text) to service_role;

-- ── get_auth_context gains password_version ───────────────────
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
$$;

revoke all on function get_auth_context() from public, anon;
grant execute on function get_auth_context() to authenticated;
