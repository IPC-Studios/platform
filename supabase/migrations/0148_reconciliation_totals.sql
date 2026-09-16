-- The reconciliation totals missed money that belongs to no project.
--
-- 0147 built every money_in figure by summing per project and adding the rows
-- up. That silently excluded two kinds of record, both of which 0145 made
-- possible and ordinary:
--
--   * a payment against an invoice that has no project (project_id is
--     nullable now, and invoices.project_id has always been optional)
--   * an invoice with no project at all
--
-- Found by marking a real payment as banked on the live system and watching
-- the Banked total stay at zero. A reconciliation screen that cannot see some
-- of the money is worse than no reconciliation screen, because it reports a
-- clean bill of health it has not checked.
--
-- The totals are now company-wide and the per-project list stays per project,
-- which is the right split: the headline is "all our money", the table is
-- "which projects do not line up".
--
-- `outstanding` also changes source. It was sum(invoiced - received) computed
-- per project; it is now the sum of invoices.balance_due, which the 0145
-- trigger derives from the ledger. Same intent, one fewer independent
-- derivation to disagree with — and it counts project-less invoices too.

create or replace function reconciliation_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_in      jsonb;
  v_out     jsonb;
  v_health  jsonb;
  v_sold       numeric;
  v_invoiced   numeric;
  v_received   numeric;
  v_banked     numeric;
  v_outstanding numeric;
  v_unbilled   numeric;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- ── Headline totals: every rupee in the studio, project or not ─────────
  select coalesce(sum(total_cost), 0) into v_sold
    from projects where company_id = v_company and status <> 'cancelled';

  -- A draft has been sent to nobody and a cancelled one withdrawn.
  select coalesce(sum(total), 0) into v_invoiced
    from invoices where company_id = v_company and status not in ('draft', 'cancelled');

  -- What a client still owes, taken from the balance the 0145 trigger keeps.
  select coalesce(sum(greatest(coalesce(balance_due, 0), 0)), 0) into v_outstanding
    from invoices where company_id = v_company and status not in ('draft', 'cancelled');

  select coalesce(sum(amount), 0) into v_received
    from received_payments where company_id = v_company and status = 'paid';

  select coalesce(sum(amount), 0) into v_banked
    from received_payments
   where company_id = v_company and status = 'paid' and cleared_at is not null;

  -- Unbilled is genuinely per project: a project's own value against its own
  -- invoices. Summing the differences is the point, so it stays a sum of
  -- per-project figures rather than sold minus invoiced overall — otherwise
  -- one over-billed project would mask another that was never billed at all.
  select coalesce(sum(greatest(p.total_cost - coalesce((
           select sum(i.total) from invoices i
            where i.project_id = p.id and i.status not in ('draft', 'cancelled')), 0), 0)), 0)
    into v_unbilled
    from projects p
   where p.company_id = v_company and p.status <> 'cancelled';

  v_in := jsonb_build_object(
    'project_value', v_sold,
    'invoiced',      v_invoiced,
    'received',      v_received,
    'banked',        v_banked,
    'outstanding',   v_outstanding,
    'unbilled',      v_unbilled,
    'unbanked',      greatest(v_received - v_banked, 0),
    'projects', coalesce((
      select jsonb_agg(row_to_json(r) order by r.unbilled desc, r.outstanding desc)
        from (
          select p.id as project_id, p.name, p.status,
                 coalesce(p.total_cost, 0) as project_value,
                 coalesce((select sum(i.total) from invoices i
                            where i.project_id = p.id
                              and i.status not in ('draft', 'cancelled')), 0) as invoiced,
                 coalesce((select sum(rp.amount) from received_payments rp
                            where rp.project_id = p.id and rp.status = 'paid'), 0) as received,
                 coalesce((select sum(rp.amount) from received_payments rp
                            where rp.project_id = p.id and rp.status = 'paid'
                              and rp.cleared_at is not null), 0) as banked,
                 greatest(coalesce((select sum(i.total) from invoices i
                            where i.project_id = p.id
                              and i.status not in ('draft', 'cancelled')), 0)
                          - coalesce((select sum(rp.amount) from received_payments rp
                            where rp.project_id = p.id and rp.status = 'paid'), 0), 0) as outstanding,
                 greatest(coalesce(p.total_cost, 0)
                          - coalesce((select sum(i.total) from invoices i
                            where i.project_id = p.id
                              and i.status not in ('draft', 'cancelled')), 0), 0) as unbilled,
                 greatest(coalesce((select sum(rp.amount) from received_payments rp
                            where rp.project_id = p.id and rp.status = 'paid'), 0)
                          - coalesce((select sum(rp.amount) from received_payments rp
                            where rp.project_id = p.id and rp.status = 'paid'
                              and rp.cleared_at is not null), 0), 0) as unbanked
            from projects p
           where p.company_id = v_company and p.status <> 'cancelled'
        ) r
       where r.outstanding > 0 or r.unbilled > 0 or r.unbanked > 0), '[]'::jsonb),
    -- Money that belongs to no project. Small in a tidy studio and worth
    -- naming: it is exactly what the first version of this report lost.
    'unassigned_received', coalesce((
      select sum(amount) from received_payments
       where company_id = v_company and status = 'paid' and project_id is null), 0),
    'unassigned_invoiced', coalesce((
      select sum(total) from invoices
       where company_id = v_company and project_id is null
         and status not in ('draft', 'cancelled')), 0)
  );

  -- ── Money out, per member (unchanged from 0147) ────────────────────────
  with per_member as (
    select u.user_id, u.name,
           coalesce((select sum(coalesce(s.final_cost, s.estimated_cost))
                       from team_assignment_slots s
                      where s.user_id = u.user_id and s.company_id = v_company
                        and s.status not in ('cancelled', 'released')), 0) as due,
           coalesce((select sum(t.amount_paid)
                       from team_slot_settlements t
                      where t.member_uid = u.user_id and t.company_id = v_company), 0) as settled
      from users u
     where u.company_id = v_company and u.deleted_at is null and u.status = 'active'
  )
  select jsonb_build_object(
    'due',         coalesce(sum(due), 0),
    'settled',     coalesce(sum(settled), 0),
    'outstanding', coalesce(sum(greatest(due - settled, 0)), 0),
    'overpaid',    coalesce(sum(greatest(settled - due, 0)), 0),
    'members', coalesce((
      select jsonb_agg(row_to_json(r) order by r.outstanding desc)
        from (
          select user_id, name, due, settled,
                 greatest(due - settled, 0) as outstanding,
                 greatest(settled - due, 0) as overpaid
            from per_member
           where due <> 0 or settled <> 0
        ) r), '[]'::jsonb)
  ) into v_out
  from per_member;

  select jsonb_build_object(
    'payments_linked_to_nothing', (
      select count(*) from received_payments
       where company_id = v_company and project_id is null and invoice_id is null),
    'invoices_paid_with_balance', (
      select count(*) from invoices
       where company_id = v_company and status = 'paid' and coalesce(balance_due, 0) > 0),
    'invoices_unpaid_but_settled', (
      select count(*) from invoices i
       where i.company_id = v_company and i.status in ('draft', 'sent')
         and coalesce(i.amount_paid, 0) > 0),
    'payments_client_mismatch', (
      select count(*) from received_payments rp
        join projects p on p.id = rp.project_id
       where rp.company_id = v_company and rp.client_id is not null
         and p.client_id is not null and rp.client_id <> p.client_id)
  ) into v_health;

  return jsonb_build_object('money_in', v_in, 'money_out', v_out, 'health', v_health);
end;
$$;

revoke all on function reconciliation_summary() from public, anon;
grant execute on function reconciliation_summary() to authenticated;
