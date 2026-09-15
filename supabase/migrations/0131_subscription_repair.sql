-- The Subscription screen has never loaded. Both endpoints behind it selected
-- columns that exist on no table, so every request 400'd:
--
--   /subscription/plans   plans.description, plans.currency, plans.duration_days
--   /subscription/status  companies.plan_key, companies.plan_name,
--                         companies.plan_gate, users.plan_gate,
--                         users.plan_expiry, payment_orders.expires_at
--
-- PL/pgSQL is not involved here — these are plain SELECTs in the API — but the
-- effect is the same as 0126: the column name lives inside a template literal,
-- so typecheck, lint and the test suite all stay green while every call fails.
--
-- Two of those groups are a genuine schema gap and are added below. The rest
-- were the API inventing names for facts that are already stored elsewhere:
-- the plan key is `companies.plan`, the plan name comes from `plans`, the gate
-- is DERIVED (0004_access_control) rather than stored, and an order's expiry
-- lives on the `company_subscriptions` row the activation writes. The router
-- now reads those instead, deriving the gate with the same CASE the access
-- payload uses so the two can never disagree about whether a studio has paid.

-- ── plan cards ────────────────────────────────────────────────
-- The contract has modelled these three since the plan card was built; only
-- the table never caught up.
alter table plans add column if not exists description text
  check (description is null or char_length(description) <= 500);
alter table plans add column if not exists currency text not null default 'INR'
  check (char_length(currency) = 3);

-- Null means "use billing_interval". A plan sold as a fixed 90-day pass needs
-- its own number; a monthly or yearly one does not.
alter table plans add column if not exists duration_days int
  check (duration_days is null or duration_days between 1 and 3650);

-- ── order history ─────────────────────────────────────────────
-- Activation writes a company_subscriptions row but nothing tied it back to
-- the order that paid for it, so the history list could not say what any
-- payment bought. Nullable: rows written before this migration have no link,
-- and the lateral fallback in the API still dates them.
alter table company_subscriptions add column if not exists order_id uuid
  references payment_orders (id) on delete set null;
create index if not exists company_subscriptions_order_idx
  on company_subscriptions (order_id) where order_id is not null;

-- Record the link from now on. Same body as 0016 otherwise.
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
  v_days    int;
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

  select case when p.billing_interval = 'yearly' then 12 else 1 end, p.duration_days
    into v_months, v_days
    from plans p where p.id = v_order.plan_id;

  -- Extend from the later of now / current expiry (no lost days).
  select greatest(now(), coalesce(plan_expiry, now())) into v_base
    from companies where id = v_order.company_id;
  -- A plan with its own duration_days wins over the monthly/yearly interval.
  v_expires := case
                 when v_days is not null then v_base + make_interval(days => v_days)
                 else v_base + make_interval(months => v_months)
               end;

  update payment_orders set status = 'paid' where id = p_order_id;
  insert into payment_transactions (order_id, company_id, razorpay_payment_id, amount)
    values (p_order_id, v_order.company_id, p_payment_id, v_order.amount);
  insert into company_subscriptions (company_id, plan_id, expires_at, order_id)
    values (v_order.company_id, v_order.plan_id, v_expires, p_order_id);
  update companies set plan_expiry = v_expires where id = v_order.company_id;
  insert into billing_events (company_id, kind, detail)
    values (v_order.company_id, 'subscription_activated', jsonb_build_object('order_id', p_order_id));

  return query select false, v_expires;
end;
$$;

revoke all on function activate_subscription(uuid, text) from public, anon;
grant execute on function activate_subscription(uuid, text) to authenticated, service_role;
