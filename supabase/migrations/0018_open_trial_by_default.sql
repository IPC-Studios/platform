-- New studios shouldn't be locked behind a subscription during early access.
-- Give every company an open-ended "grandfathered" period by default, and
-- backfill existing studios that have no active gate. Billing can tighten this
-- later (set a real plan_expiry on payment; the subscription flow already does).

-- Default gate for new companies (evaluated per insert).
alter table companies
  alter column grandfathered_until set default (now() + interval '10 years');

-- Unblock any existing studio with no live gate (newly registered ones).
update companies
  set grandfathered_until = now() + interval '10 years'
  where greatest(
    coalesce(plan_expiry,         'epoch'::timestamptz),
    coalesce(grandfathered_until, 'epoch'::timestamptz),
    coalesce(grace_until,         'epoch'::timestamptz)
  ) <= now();
