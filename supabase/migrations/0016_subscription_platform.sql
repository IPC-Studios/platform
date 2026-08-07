-- Phase 14: subscription & platform. Server-side pricing (+18% GST), idempotent
-- activation, and replay-proof webhook events. Payment activation advances
-- companies.plan_expiry; a replayed order/webhook changes nothing.

create table payment_orders (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies (id) on delete cascade,
  plan_id          uuid not null references plans (id),
  amount           numeric(12, 2) not null,   -- price + GST, server-computed
  currency         text not null default 'INR',
  razorpay_order_id text unique,
  status           text not null default 'created' check (status in ('created', 'paid', 'failed')),
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);
create index payment_orders_company_idx on payment_orders (company_id);

create table payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references payment_orders (id) on delete cascade,
  company_id         uuid not null references companies (id) on delete cascade,
  razorpay_payment_id text,
  amount             numeric(12, 2) not null,
  status             text not null default 'captured',
  created_at         timestamptz not null default now()
);

create table company_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  plan_id    uuid not null references plans (id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status     text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  created_at timestamptz not null default now()
);
create index company_subscriptions_company_idx on company_subscriptions (company_id, status);

-- Idempotency ledger for provider webhooks (keyed on the provider event id).
create table razorpay_webhook_events (
  event_id     text primary key,
  payload      jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

create table billing_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Platform operator allowlist (cross-tenant console access).
create table platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table payment_orders          enable row level security;
alter table payment_transactions    enable row level security;
alter table company_subscriptions   enable row level security;
alter table billing_events          enable row level security;
-- webhook events + platform_admins: no client policies (definer/service only).
alter table razorpay_webhook_events enable row level security;
alter table platform_admins         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['payment_orders','payment_transactions','company_subscriptions','billing_events']
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
  end loop;
end $$;

-- ── Create an order (server-side price + 18% GST) ─────────────
create or replace function create_payment_order(p_plan_id uuid)
returns table (order_id uuid, amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_price   numeric;
  v_amount  numeric;
  v_id      uuid;
begin
  if not is_current_owner() then
    raise exception 'only the owner can start a subscription' using errcode = '42501';
  end if;
  select price into v_price from plans where id = p_plan_id and is_active;
  if v_price is null then
    raise exception 'unknown plan' using errcode = '42501';
  end if;
  v_amount := round(v_price * 1.18, 2);  -- +18% GST (kept from the original)
  insert into payment_orders (company_id, plan_id, amount, created_by)
    values (v_company, p_plan_id, v_amount, auth.uid())
    returning id into v_id;
  return query select v_id, v_amount;
end;
$$;

-- ── Idempotent activation ─────────────────────────────────────
-- Signature is verified in the API (Worker HMAC) before this is called. This
-- marks the order paid, records the transaction, extends the subscription and
-- advances plan_expiry — all once. A repeat call returns duplicate = true.
create or replace function activate_subscription(
  p_order_id   uuid,
  p_payment_id text
)
returns table (duplicate boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   payment_orders;
  v_months  int := 1;
  v_expires timestamptz;
  v_base    timestamptz;
begin
  select * into v_order from payment_orders where id = p_order_id for update;
  if not found then
    raise exception 'unknown order' using errcode = '42501';
  end if;
  if v_order.status = 'paid' then
    select cs.expires_at into v_expires from company_subscriptions cs
      where cs.company_id = v_order.company_id order by cs.expires_at desc limit 1;
    return query select true, v_expires;
    return;
  end if;

  select case when billing_interval = 'yearly' then 12 else 1 end into v_months
    from plans where id = v_order.plan_id;

  -- Extend from the later of now / current expiry (no lost days).
  select greatest(now(), coalesce(plan_expiry, now())) into v_base
    from companies where id = v_order.company_id;
  v_expires := v_base + make_interval(months => v_months);

  update payment_orders set status = 'paid' where id = p_order_id;
  insert into payment_transactions (order_id, company_id, razorpay_payment_id, amount)
    values (p_order_id, v_order.company_id, p_payment_id, v_order.amount);
  insert into company_subscriptions (company_id, plan_id, expires_at)
    values (v_order.company_id, v_order.plan_id, v_expires);
  update companies set plan_expiry = v_expires where id = v_order.company_id;
  insert into billing_events (company_id, kind, detail)
    values (v_order.company_id, 'subscription_activated', jsonb_build_object('order_id', p_order_id));

  return query select false, v_expires;
end;
$$;

-- Replay-proof webhook recording. Returns true only the first time.
create or replace function record_webhook_event(p_event_id text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows int;
begin
  insert into razorpay_webhook_events (event_id, payload) values (p_event_id, p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function create_payment_order(uuid)          from public, anon;
revoke all on function activate_subscription(uuid, text)   from public, anon;
revoke all on function record_webhook_event(text, jsonb)   from public, anon;
grant execute on function create_payment_order(uuid) to authenticated;
grant execute on function activate_subscription(uuid, text) to authenticated, service_role;
grant execute on function record_webhook_event(text, jsonb) to service_role;
