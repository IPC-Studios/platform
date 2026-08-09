-- Platform ops: the vendor console's write actions (extend / expire / grant
-- trial on a tenant's plan). Same allowlist gate as the read RPCs in 0019 —
-- is_platform_admin() only — and every mutation logs a billing_event so the
-- action is auditable. plan_gate is recomputed from these three date columns
-- (see platform_plan_gate / get_auth_context), so setting them IS the effect.

-- ── extend a studio's paid plan by N months ───────────────────
create or replace function platform_extend_plan(p_company_id uuid, p_months int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_expiry timestamptz;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 60 then
    raise exception 'months must be between 1 and 60' using errcode = '22023';
  end if;
  update companies
    set plan_expiry = greatest(now(), coalesce(plan_expiry, now())) + make_interval(months => p_months)
    where id = p_company_id
    returning plan_expiry into v_expiry;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_extended',
            jsonb_build_object('months', p_months, 'by', auth.uid(), 'new_expiry', v_expiry));
  return v_expiry;
end;
$$;

-- ── expire a studio now (revoke access immediately) ───────────
create or replace function platform_expire_plan(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update companies
    set plan_expiry         = now() - interval '1 second',
        grandfathered_until = null,
        grace_until         = null
    where id = p_company_id;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_expired', jsonb_build_object('by', auth.uid()));
end;
$$;

-- ── grant an open-ended grandfathered trial (mirrors 0018) ────
create or replace function platform_grant_trial(p_company_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_until timestamptz;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update companies
    set grandfathered_until = now() + interval '10 years'
    where id = p_company_id
    returning grandfathered_until into v_until;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_trial_granted', jsonb_build_object('by', auth.uid(), 'until', v_until));
  return v_until;
end;
$$;

revoke all on function platform_extend_plan(uuid, int) from public, anon;
revoke all on function platform_expire_plan(uuid)      from public, anon;
revoke all on function platform_grant_trial(uuid)      from public, anon;
grant execute on function platform_extend_plan(uuid, int) to authenticated;
grant execute on function platform_expire_plan(uuid)      to authenticated;
grant execute on function platform_grant_trial(uuid)      to authenticated;
