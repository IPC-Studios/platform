-- Phase 1: Row-Level Security. Under Fork 1 = B, RLS is the PRIMARY enforcement
-- (not dead weight). companies/users stay readable to members even when the
-- plan is expired, so the "plan expired" screen + subscription page still load;
-- feature tables (Phase 4+) add is_current_user_active() which includes the
-- plan gate.

alter table companies                enable row level security;
alter table users                    enable row level security;
alter table employee_roles           enable row level security;
alter table employee_role_assignments enable row level security;
alter table plans                    enable row level security;
alter table coupons                  enable row level security;

-- ── companies ─────────────────────────────────────────────────
create policy companies_select_own on companies
  for select to authenticated
  using (id = get_current_company_id());

create policy companies_update_owner on companies
  for update to authenticated
  using (id = get_current_company_id() and is_current_owner())
  with check (id = get_current_company_id() and is_current_owner());

-- ── users ─────────────────────────────────────────────────────
create policy users_select_same_company on users
  for select to authenticated
  using (company_id = get_current_company_id());

-- Owner manages any member; anyone may edit their own row.
create policy users_update_owner_or_self on users
  for update to authenticated
  using (
    company_id = get_current_company_id()
    and (is_current_owner() or user_id = auth.uid())
  )
  with check (company_id = get_current_company_id());

create policy users_insert_owner on users
  for insert to authenticated
  with check (company_id = get_current_company_id() and is_current_owner());

create policy users_delete_owner on users
  for delete to authenticated
  using (company_id = get_current_company_id() and is_current_owner());

-- ── employee_roles ────────────────────────────────────────────
create policy employee_roles_select on employee_roles
  for select to authenticated
  using (company_id = get_current_company_id());

create policy employee_roles_write_owner on employee_roles
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());

-- ── employee_role_assignments ─────────────────────────────────
create policy era_select on employee_role_assignments
  for select to authenticated
  using (company_id = get_current_company_id());

create policy era_write_owner on employee_role_assignments
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());

-- ── plans / coupons (platform catalogue, cross-tenant read) ───
-- Any authenticated user may read active plans/coupons (needed at checkout).
-- Writes happen via service_role only (which bypasses RLS) — no write policy.
create policy plans_select_active on plans
  for select to authenticated
  using (is_active);

create policy coupons_select_active on coupons
  for select to authenticated
  using (is_active);
