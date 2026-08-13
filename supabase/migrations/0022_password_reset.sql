-- Password reset (the other half of the GoTrue replacement). Same shape as
-- 0021 email verification: identity-level, no tenant scope, reachable only via
-- SECURITY DEFINER functions under service_role — it has to work for a user who
-- cannot log in.
--
-- Extra piece: `password_changed_at`. Access tokens are stateless HS256 with a
-- 7-day life, so a reset alone would NOT evict a session an attacker already
-- holds. get_auth_context now returns this stamp and the API refuses any token
-- issued before it.

alter table auth.users
  add column if not exists password_changed_at timestamptz;

create table if not exists password_reset_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists prt_user_idx on password_reset_tokens (user_id);

alter table password_reset_tokens enable row level security;
-- No client policies: reachable only through the SECURITY DEFINER functions.

-- Issue a reset token; returns the RAW value once (only its hash is stored).
-- Invalidates any prior unconsumed token for that user. Short-lived (1 hour) —
-- a reset link is a live credential, unlike the 24h verification link.
create or replace function issue_password_reset(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  update password_reset_tokens set consumed_at = now()
    where user_id = p_user_id and consumed_at is null;
  insert into password_reset_tokens (user_id, token_hash, expires_at)
    values (p_user_id, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), now() + interval '1 hour');
  return v_raw;
end;
$$;

-- Consume a raw token AND set the new password in one transaction: the API
-- hashes (argon2id, Bun-side) and passes the hash in. Returns the user id, or
-- null if the token is invalid / expired / already used.
--
-- Completing a reset also proves control of the mailbox, so it verifies the
-- email — otherwise a user who never clicked the verification link would reset
-- successfully and still be refused at sign-in.
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
     set encrypted_password = p_password_hash,
         password_changed_at = now(),
         email_verified      = true,
         email_verified_at   = coalesce(email_verified_at, now())
   where id = v_user;

  -- Any other outstanding reset link for this user dies with it.
  update password_reset_tokens set consumed_at = now()
    where user_id = v_user and consumed_at is null;

  return v_user;
end;
$$;

revoke all on function issue_password_reset(uuid) from public, anon;
revoke all on function consume_password_reset(text, text) from public, anon;
grant execute on function issue_password_reset(uuid)          to service_role;
grant execute on function consume_password_reset(text, text)  to service_role;

-- ── get_auth_context gains password_changed_at ────────────────
-- Return type changes, so it must be dropped first (same dance as 0019).
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
  password_changed_at timestamptz
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
    au.password_changed_at
  from users u
  join companies c on c.id = u.company_id
  join auth.users au on au.id = u.user_id
  where u.user_id = auth.uid()
$$;

-- Re-assert 0002's grants: dropping the function dropped them with it.
revoke all on function get_auth_context() from public, anon;
grant execute on function get_auth_context() to authenticated;
