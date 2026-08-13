-- Refresh tokens. Until now the only credential was a 7-day access token, so
-- every user got a hard logout once a week and a stolen token stayed good for
-- its whole life. Access tokens drop to minutes; a long-lived refresh token
-- rotates them.
--
-- Same custody rules as the other identity tables: only the sha256 hash is
-- stored, and nothing is reachable except through SECURITY DEFINER functions
-- called under service_role.

create table if not exists refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- One family per sign-in. Rotation keeps the family; reuse kills it.
  family_id   uuid not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists rt_user_idx   on refresh_tokens (user_id);
create index if not exists rt_family_idx on refresh_tokens (family_id);

alter table refresh_tokens enable row level security;
-- No client policies: reachable only through the SECURITY DEFINER functions.

-- Start a new session. Returns the RAW token once.
create or replace function issue_refresh_token(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    p_user_id,
    gen_random_uuid(),
    encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'),
    now() + interval '30 days'
  );
  return v_raw;
end;
$$;

-- Exchange a refresh token for its successor. Returns the user and the new RAW
-- token, or nulls if the presented token is unusable.
--
-- Reuse of an already-rotated token is the classic stolen-token signal, so the
-- whole family is revoked — except within a short grace window, where it is far
-- more likely to be two tabs refreshing at once. Those just fail this call and
-- pick up the winner's token.
create or replace function rotate_refresh_token(p_raw text)
returns table (user_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     refresh_tokens%rowtype;
  v_new_raw text;
begin
  select * into v_row from refresh_tokens
    where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');

  if v_row.id is null or v_row.revoked_at is not null or v_row.expires_at <= now() then
    return query select null::uuid, null::text;
    return;
  end if;

  if v_row.consumed_at is not null then
    if v_row.consumed_at < now() - interval '60 seconds' then
      update refresh_tokens set revoked_at = now()
        where family_id = v_row.family_id and revoked_at is null;
    end if;
    return query select null::uuid, null::text;
    return;
  end if;

  v_new_raw := gen_random_uuid()::text || gen_random_uuid()::text;
  update refresh_tokens set consumed_at = now() where id = v_row.id;
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    v_row.user_id,
    v_row.family_id,
    encode(sha256(convert_to(v_new_raw, 'UTF8')), 'hex'),
    -- The family does not outlive the original 30 days: a session cannot be
    -- kept alive forever by refreshing.
    v_row.expires_at
  );

  return query select v_row.user_id, v_new_raw;
end;
$$;

-- Sign out on this device: kill the presented token's family.
create or replace function revoke_refresh_family(p_raw text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update refresh_tokens set revoked_at = now()
   where revoked_at is null
     and family_id = (
       select family_id from refresh_tokens
        where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     );
end;
$$;

-- Sign out everywhere: revoke every family AND bump password_version, which
-- strands the access tokens already issued (see the API's requireAuth).
create or replace function revoke_all_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
begin
  update refresh_tokens set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;
  update auth.users set password_version = password_version + 1
   where id = p_user_id
   returning password_version into v_version;
  return v_version;
end;
$$;

revoke all on function issue_refresh_token(uuid)   from public, anon;
revoke all on function rotate_refresh_token(text)  from public, anon;
revoke all on function revoke_refresh_family(text) from public, anon;
revoke all on function revoke_all_sessions(uuid)   from public, anon;
grant execute on function issue_refresh_token(uuid)   to service_role;
grant execute on function rotate_refresh_token(text)  to service_role;
grant execute on function revoke_refresh_family(text) to service_role;
grant execute on function revoke_all_sessions(uuid)   to service_role;
