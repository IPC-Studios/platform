-- Email verification (replaces the GoTrue freebie). Identity-level, not tenant-
-- scoped: tokens live off auth.users, no company_id / active-session checks, so
-- they work before the user can log in. Hard gate — login is refused until
-- verified (see the API's /auth/login).

alter table auth.users
  add column if not exists email_verified    boolean not null default false,
  add column if not exists email_verified_at timestamptz;

-- Existing accounts (created before this migration) are grandfathered verified,
-- so nobody already onboarded gets locked out.
update auth.users set email_verified = true, email_verified_at = now()
  where email_verified = false;

create table if not exists email_verification_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists evt_user_idx on email_verification_tokens (user_id);

alter table email_verification_tokens enable row level security;
-- No client policies: reachable only through the SECURITY DEFINER functions.

-- Issue a token for a user; returns the RAW value once (only its hash is
-- stored). Invalidates any prior unconsumed token for that user. Called from the
-- API under service_role (register / resend) — no session context needed.
create or replace function issue_email_verification(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  update email_verification_tokens set consumed_at = now()
    where user_id = p_user_id and consumed_at is null;
  insert into email_verification_tokens (user_id, token_hash, expires_at)
    values (p_user_id, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), now() + interval '24 hours');
  return v_raw;
end;
$$;

-- Consume a raw token: mark it used, flip the user to verified, return the user
-- id. Returns null if the token is invalid / expired / already used.
create or replace function consume_email_verification(p_raw text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update email_verification_tokens set consumed_at = now()
    where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
      and consumed_at is null
      and expires_at > now()
    returning user_id into v_user;
  if v_user is null then
    return null;
  end if;
  update auth.users set email_verified = true, email_verified_at = now()
    where id = v_user;
  return v_user;
end;
$$;

revoke all on function issue_email_verification(uuid) from public, anon;
revoke all on function consume_email_verification(text) from public, anon;
grant execute on function issue_email_verification(uuid)  to service_role;
grant execute on function consume_email_verification(text) to service_role;
