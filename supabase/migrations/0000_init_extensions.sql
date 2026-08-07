-- Phase 0: baseline extensions. Real tenancy schema lands in Phase 1.
-- Idempotent so re-running against an existing DB is safe.

create extension if not exists pgcrypto with schema extensions;      -- gen_random_uuid()
create extension if not exists btree_gist with schema extensions;    -- team-slot exclusion constraint (Phase 6)
create extension if not exists pg_trgm with schema extensions;       -- CRM fuzzy dedupe (Phase 11)

-- Convention: every tenant-scoped table carries company_id uuid not null,
-- and RLS is the primary enforcement (Fork 1 = Supabase Auth + RLS).
