-- Review fixes for the session work in 0022-0024. Everything here is corrective:
-- 0023/0024 already applied on the live database, so nothing above is edited.

-- ── 1. Backfill password_version for pre-0023 resets ──────────
-- 0023 added the column with `default 0` and no backfill. Under 0022 a reset was
-- enforced by `iat < password_changed_at`; after 0023 the check became
-- `pwv != password_version`, and a token minted before that reset carries no
-- claim (read as 0), which matches the un-backfilled 0 — silently re-validating
-- a session 0022 was refusing. No-op wherever 0022 and 0023 applied together.
update auth.users
   set password_version = 1
 where password_changed_at is not null
   and password_version = 0;

-- ── 2. Make rotation single-use under concurrency ─────────────
-- The old body read the row with a bare `select * into` and then consumed it
-- with a primary-key-only update. Under READ COMMITTED two concurrent rotations
-- of one token both saw `consumed_at is null`; the second blocked on the row
-- lock, re-evaluated a qual that only tested `id`, and proceeded — so both
-- minted a successor and the family held two live tokens.
--
-- Consumption is now the guard: a conditional UPDATE ... RETURNING is atomic, so
-- exactly one caller can claim a token. `found` distinguishes "claimed it" from
-- "someone else got there first".
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
  -- Atomically claim the token. Only the winner of a race gets a row back.
  update refresh_tokens
     set consumed_at = now()
   where token_hash = v_hash
     and consumed_at is null
     and revoked_at is null
     and expires_at > now()
   returning * into v_row;

  if not found then
    -- Did not claim it. Reuse of an already-rotated token is the stolen-token
    -- signal, so revoke the family — unless the consumption is very recent, in
    -- which case this is the loser of a two-tab race, not an attacker.
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

  v_new_raw := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    v_row.user_id,
    v_row.family_id,
    encode(sha256(convert_to(v_new_raw, 'UTF8')), 'hex'),
    -- The family does not outlive the original 30 days.
    v_row.expires_at
  );

  return query select v_row.user_id, v_new_raw;
end;
$$;

-- ── 3. Bound the revoke sweeps to live sessions ───────────────
-- Both predicates filtered only on `revoked_at is null`, which matches every
-- consumed row the user has ever produced — so one sign-out rewrote a year of
-- dead rows to revoke two live sessions.
create or replace function revoke_refresh_family(p_raw text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update refresh_tokens set revoked_at = now()
   where revoked_at is null
     and expires_at > now()
     and family_id = (
       select family_id from refresh_tokens
        where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     );
end;
$$;

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
   where user_id = p_user_id and revoked_at is null and expires_at > now();
  update auth.users set password_version = password_version + 1
   where id = p_user_id
   returning password_version into v_version;
  return v_version;
end;
$$;

-- ── 4. Sweep spent refresh tokens ─────────────────────────────
-- The table was append-only: one row per rotation, ~48/day/user, nothing ever
-- deleted. Kept a week past expiry so a support question can still be answered.
create index if not exists rt_expires_idx on refresh_tokens (expires_at);

create or replace function purge_expired_refresh_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from refresh_tokens where expires_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ── 5. Close the `authenticated` execute grant ────────────────
-- The bootstrap's `alter default privileges ... grant execute on functions to
-- authenticated, service_role` applies to every function created afterwards, and
-- a `revoke ... from public` does not remove a direct role grant. These take a
-- user id as a parameter and are SECURITY DEFINER, so RLS is no defence: a raw
-- query as `authenticated` could mint a session for any account. Service role
-- only — the API never calls them through withUser.
revoke all on function issue_refresh_token(uuid)          from public, anon, authenticated;
revoke all on function rotate_refresh_token(text)         from public, anon, authenticated;
revoke all on function revoke_refresh_family(text)        from public, anon, authenticated;
revoke all on function revoke_all_sessions(uuid)          from public, anon, authenticated;
revoke all on function purge_expired_refresh_tokens()     from public, anon, authenticated;
revoke all on function issue_password_reset(uuid)         from public, anon, authenticated;
revoke all on function consume_password_reset(text, text) from public, anon, authenticated;
revoke all on function issue_email_verification(uuid)     from public, anon, authenticated;
revoke all on function consume_email_verification(text)   from public, anon, authenticated;

grant execute on function issue_refresh_token(uuid)          to service_role;
grant execute on function rotate_refresh_token(text)         to service_role;
grant execute on function revoke_refresh_family(text)        to service_role;
grant execute on function revoke_all_sessions(uuid)          to service_role;
grant execute on function purge_expired_refresh_tokens()     to service_role;
grant execute on function issue_password_reset(uuid)         to service_role;
grant execute on function consume_password_reset(text, text) to service_role;
grant execute on function issue_email_verification(uuid)     to service_role;
grant execute on function consume_email_verification(text)   to service_role;
