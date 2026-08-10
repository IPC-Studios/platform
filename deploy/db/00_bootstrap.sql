-- Self-hosted Postgres bootstrap. Runs ONCE before supabase/migrations/0001+.
-- Recreates the slice of the Supabase platform the app's SQL depends on, so
-- every existing migration (RLS policies, SECURITY DEFINER functions, grants,
-- the GiST exclusion constraint) runs UNCHANGED on plain Postgres.
--
-- Replaces: GoTrue (auth.users + password), PostgREST role model, the Supabase
-- `extensions` schema. Idempotent — safe to re-run.

-- ── extensions (into public so they're on the default search_path) ──
create extension if not exists pgcrypto;    -- gen_random_uuid() (also core since PG13)
create extension if not exists btree_gist;  -- team-slot exclusion constraint (0008)
create extension if not exists pg_trgm;     -- CRM fuzzy dedupe (0013)

-- ── PostgREST-style role model ──────────────────────────────────
-- authenticator: the LOGIN role the API connects as; owns no objects and
-- inherits nothing — it only SET ROLEs into one of the three below per request.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;  -- the RLS-bypass path
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- Table/sequence privileges. Supabase auto-grants these to its roles; a plain
-- cluster does not, so without this every query fails permission-denied BEFORE
-- RLS runs. Set as DEFAULT privileges here (before the migrations create any
-- table) so every migration table is covered. RLS still gates `authenticated`;
-- `service_role` bypasses RLS but still needs the grant.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- ── auth schema: identity store + the uid() RLS primitive ───────
create schema if not exists auth;

-- Every FK to auth.users across the schema resolves here. encrypted_password
-- is the GoTrue replacement (hashed with Bun.password, argon2id).
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  encrypted_password text,
  created_at         timestamptz not null default now()
);

-- auth.uid() reads the per-request GUC the API sets inside each transaction
-- (set_config('request.jwt.claim.sub', <uid>, true)). Identical contract to
-- Supabase's auth.uid(), so no policy or function needs to change.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated;
-- service_role manages accounts (register / add-member insert the auth user).
grant select, insert, update on auth.users to service_role;
