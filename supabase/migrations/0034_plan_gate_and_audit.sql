-- 0034: put the plan gate back where it belongs, and add the audit trail.
--
-- ── 1. The tenancy oracle must not carry the plan gate ────────
-- 0033 folded is_company_plan_active() into get_current_company_id(). That
-- function is the predicate under EVERY RLS policy, including the two that
-- 0003 deliberately left readable on an expired plan — companies and users —
-- so the owner can reach the subscription page and pay. With 0033 an expired
-- studio could not read its own company row, create_payment_order() saw
-- is_current_owner() = false, and the refresh family was revoked within the
-- half hour: the recovery path sat behind the thing it recovers from.
--
-- The gate lives in is_current_user_active() (0002), which every feature table
-- already uses. This restores the 0002/0003 split: identity resolves for any
-- live member; feature access additionally needs a live plan.
create or replace function get_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.company_id from users u
  where u.user_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
$$;

-- Same split for rotation: a removed or deactivated member loses the session,
-- an expired plan does not. Everything else is 0025's atomic claim unchanged.
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
  update refresh_tokens
     set consumed_at = now()
   where token_hash = v_hash
     and consumed_at is null
     and revoked_at is null
     and expires_at > now()
   returning * into v_row;

  if not found then
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

  -- A member row that has been soft-deleted or deactivated ends the session
  -- here rather than at the next access-token mint. An account with no member
  -- row yet (mid-registration) is not a dead member.
  if exists (
    select 1 from users u
    where u.user_id = v_row.user_id
      and (u.deleted_at is not null or u.status <> 'active')
  ) then
    update refresh_tokens set revoked_at = now()
      where family_id = v_row.family_id and revoked_at is null;
    return query select null::uuid, null::text;
    return;
  end if;

  v_new_raw := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
  values (
    v_row.user_id,
    v_row.family_id,
    encode(sha256(convert_to(v_new_raw, 'UTF8')), 'hex'),
    v_row.expires_at
  );

  return query select v_row.user_id, v_new_raw;
end;
$$;

revoke all on function get_current_company_id() from public, anon;
grant execute on function get_current_company_id() to authenticated;
revoke all on function rotate_refresh_token(text) from public, anon, authenticated;
grant execute on function rotate_refresh_token(text) to service_role;

-- ── 2. A generic audit trail ──────────────────────────────────
-- access_audit_logs, billing_events and crm_lead_events each record one kind
-- of change. Nothing recorded who renamed the studio, removed a member,
-- deleted a lead source or activated a plan. This is the one table for that:
-- who, what, on which row, before and after, tied to the request id the API
-- logged under.
create table if not exists audit_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  before         jsonb,
  after          jsonb,
  ip             text,
  correlation_id text,
  created_at     timestamptz not null default now()
);
create index if not exists audit_logs_company_idx on audit_logs (company_id, created_at desc);
create index if not exists audit_logs_entity_idx  on audit_logs (company_id, entity_type, entity_id);

alter table audit_logs enable row level security;

-- The owner reads the studio's trail. Nobody writes to it directly: every row
-- goes through audit_log_write(), which stamps the caller's own company.
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'audit_logs_select_owner') then
    create policy audit_logs_select_owner on audit_logs
      for select to authenticated
      using (company_id = get_current_company_id() and is_current_owner());
  end if;
end $$;

create or replace function audit_log_write(
  p_action         text,
  p_entity_type    text,
  p_entity_id      text default null,
  p_before         jsonb default null,
  p_after          jsonb default null,
  p_ip             text default null,
  p_correlation_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
begin
  if v_company is null then
    raise exception 'no company in scope' using errcode = '42501';
  end if;
  insert into audit_logs (company_id, actor_user_id, action, entity_type, entity_id, before, after, ip, correlation_id)
  values (v_company, auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, p_ip, p_correlation_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function audit_log_write(text, text, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function audit_log_write(text, text, text, jsonb, jsonb, text, text) to authenticated, service_role;

-- ── 3. cron_runs is also readable from the vendor console ─────
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'cron_runs_select_platform') then
    create policy cron_runs_select_platform on cron_runs
      for select to authenticated
      using (is_platform_admin());
  end if;
end $$;

-- ── 4. A lead's trail starts at creation ──────────────────────
-- 0032 stamps an event on every status change but nothing on the insert, so
-- the first line of every history was the first move rather than the arrival.
-- Definer, because capture_lead() inserts for the anon webhook role, which has
-- no policy on crm_lead_events.
create or replace function log_crm_lead_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (new.company_id, new.id, null, new.status, auth.uid(),
          case when new.source_key is not null then 'arrived via ' || new.source else 'created' end);
  return new;
end;
$$;

drop trigger if exists crm_leads_log_created on crm_leads;
create trigger crm_leads_log_created after insert on crm_leads
  for each row execute function log_crm_lead_created();
