-- Lovable parity: a company-wide fixed-overhead expense (rent, software,
-- anything with no project_id) was excluded from every project's profit
-- entirely -- project_expenses only ever summed rows with a matching
-- project_id. The `is_fixed_overhead` flag and `allocation_method` column
-- have existed since 0012 and were never read by anything: not a missing
-- settings screen, a wrong number in the one place a studio checks a
-- project's real profitability.
--
-- The old app's version computed this per month with a choice of three
-- weightings (equal / by booked revenue / by shoot days), read from a
-- Supabase edge function this repo does not carry over. This implements the
-- equal split only -- the column's own default, and the one that needs
-- nothing else to be true to compute correctly. Revenue- and
-- shoot-day-weighted allocation are not built; if a studio needs them, that
-- is real, separately-scoped follow-up work, not a fix to slot in here.
create or replace view project_financials
with (security_invoker = on) as
select
  p.id         as project_id,
  p.company_id,
  p.name,
  p.total_cost as revenue,
  coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id), 0) as received,
  coalesce((
    select sum(coalesce(s.final_cost, s.estimated_cost))
    from team_assignment_slots s
    where s.shoot_id in (select id from shoots where project_id = p.id)
      and s.status not in ('cancelled', 'released')
  ), 0) as direct_team_cost,
  coalesce((select sum(e.amount) from expenses e where e.project_id = p.id), 0)
    + case when p.status = 'cancelled' then 0 else
      coalesce(
        (select sum(e.amount) from expenses e
          where e.company_id = p.company_id and e.project_id is null and e.is_fixed_overhead)
        / nullif((
            select count(*) from projects p2
             where p2.company_id = p.company_id and p2.status <> 'cancelled'
          ), 0),
        0
      ) end as project_expenses
from projects p;
