-- Three more routes that write directly to a table RLS never let them write.
--
-- Same shape as 0138, found by scanning every `withUser` block in the API for
-- insert/update/delete against a table with no policy for that command.
-- `withService` writes are excluded: service_role bypasses RLS and is the
-- legitimate way to touch a definer-only table.
--
-- The three behave differently on failure, which is why none of them looked
-- like the same bug:
--
--   PATCH /work/submissions/:id    UPDATE is FILTERED by RLS, not refused, so
--                                  it matched zero rows and the route reported
--                                  "We could not update this submission."
--   POST  .../revoke-delivery      Same filtering, but the handler returns true
--                                  unconditionally — so it reported success
--                                  while revoked_at was never written. The
--                                  access token itself IS revoked (definer
--                                  function), so the link died while the record
--                                  still showed it live.
--   POST  /platform/studios        INSERT is refused outright: vendor-
--                                  provisioned studio creation always 403'd.

-- ── editing your own submission before it is reviewed ─────────
-- Mirrors update_work_submission() exactly: your studio, you or a manager, and
-- only while still 'submitted'. Putting the reviewed rule in the policy means
-- an edit after review matches no row instead of raising — the route already
-- treats "no rows" as failure, and 23514 is no longer the signal, so the
-- handler's onCode mapping for it is now dead but harmless.
drop policy if exists tws_update on team_work_submissions;
create policy tws_update on team_work_submissions
  for update to authenticated
  using (
    company_id = get_current_company_id()
    and status = 'submitted'
    and (is_current_admin_or_manager() or submitted_by = auth.uid())
  )
  with check (
    company_id = get_current_company_id()
    and (is_current_admin_or_manager() or submitted_by = auth.uid())
  );

-- ── marking a client delivery revoked ─────────────────────────
-- Read is already company-scoped (twcd_select, 0010). Revoking is an
-- admin/manager action: the same people who could deliver it.
drop policy if exists twcd_update on team_work_client_deliveries;
create policy twcd_update on team_work_client_deliveries
  for update to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id());

-- ── the vendor provisioning a studio ──────────────────────────
-- Not a studio-scoped action: a platform admin belongs to the vendor, not to
-- the tenant being created, so get_current_company_id() cannot authorise it.
-- The allowlist is the gate, and the route is already behind
-- requirePlatformAdmin(). No update or delete — removing a tenant is not a
-- thing this console does.
drop policy if exists companies_platform_insert on companies;
create policy companies_platform_insert on companies
  for insert to authenticated
  with check (is_platform_admin());

-- ── the seed trigger that fires when a studio is created ──────
-- seed_custom_lookups_for_company() is a plain plpgsql trigger, so it runs as
-- whoever inserted the company. Registration goes through service_role and
-- bypasses RLS, which is why this never surfaced — but the platform console
-- creates a studio as the vendor under RLS, and the trigger's insert into
-- custom_lookups is then checked against get_current_company_id(), which is
-- the VENDOR's company, not the brand-new one. Provisioning failed on the
-- trigger rather than on the companies row itself.
--
-- Definer, like companies_seed_crm_trigger() beside it. It can only ever write
-- rows keyed to new.id, so the elevated context has nothing else to reach.
create or replace function seed_custom_lookups_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'lead_source', v.value, v.sort_order, true
  from (values ('manual',1),('facebook',2),('instagram',3),('whatsapp',4),('website',5),('google',6),('referral',7),('other',8)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;
  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'expense_category', v.value, v.sort_order, true
  from (values ('travel',1),('food',2),('accommodation',3),('supplies',4),('equipment',5),('communication',6),('other',7)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;
  return new;
end;
$$;
