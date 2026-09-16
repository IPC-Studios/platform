-- The table 0128 describes and nothing ever created.
--
-- 0128 relaxed companies.owner_user_id so a vendor-provisioned studio can exist
-- unclaimed, and documented the claim path: "no one holds owner rights over it
-- until someone registers against its platform_studio_invites row." That table
-- was never created by any migration.
--
-- POST /platform/studios writes the invited owner's email, name, phone and plan
-- into it inside a try/catch commented "pre-migration: studio row already
-- exists, keep going" — so every provisioning silently swallowed a "relation
-- does not exist" and threw the owner's details away. The result was an orphan
-- company with no owner, no record of who it was for, and no way to claim it.

create table if not exists platform_studio_invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  email       text not null,
  name        text,
  phone       text,
  plan_key    text,
  invited_by  uuid references auth.users (id) on delete set null,
  -- Set when the invited person registers and takes ownership.
  claimed_at  timestamptz,
  claimed_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- The route upserts with `on conflict do nothing`, so it needs a constraint to
-- conflict against. One invite per address per studio: re-provisioning the same
-- studio for the same person is a no-op rather than a second pending claim.
create unique index if not exists platform_studio_invites_company_email_idx
  on platform_studio_invites (company_id, lower(email));
create index if not exists platform_studio_invites_email_idx
  on platform_studio_invites (lower(email)) where claimed_at is null;

alter table platform_studio_invites enable row level security;

-- The vendor console only. A studio owner has no business reading who else was
-- invited to which tenant; registration resolves an invite under service_role,
-- which bypasses RLS, so it needs no policy here.
drop policy if exists psi_platform_all on platform_studio_invites;
create policy psi_platform_all on platform_studio_invites
  for all to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

-- INSERT ... RETURNING needs a SELECT policy covering the new row, and
-- companies_select_own only ever covers the caller's OWN company — which a
-- vendor provisioning someone else's studio is not. Without this the route's
-- `returning id` fails even though the insert itself is allowed. The platform
-- console already lists every studio through definer functions, so this grants
-- nothing it could not already see.
drop policy if exists companies_platform_select on companies;
create policy companies_platform_select on companies
  for select to authenticated
  using (is_platform_admin());
