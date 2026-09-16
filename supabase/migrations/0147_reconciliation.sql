-- Reconciliation: the one screen where two derivations of the same rupee have
-- to agree.
--
-- Both money bugs found on 2026-09-16 had the same shape — two independent
-- readings of the same money, never displayed side by side. The invoice said
-- paid; the project said nothing received. Each screen was internally
-- consistent, so each looked right, and nobody compares two screens.
--
-- This function puts them together. A difference is not hidden here; it is a
-- column.

-- ── Banked ───────────────────────────────────────────────────────────────
-- `received` means the studio recorded a payment. `banked` means somebody
-- confirmed it actually landed in the account. Those are different facts and
-- the gap between them is the one worth watching — a UPI that bounced, a
-- cheque that never cleared, a payment entered from a promise on WhatsApp.
--
-- Deliberately a human confirmation and not a statement import. There is no
-- bank feed in this system, and a column that quietly means "someone typed a
-- UTR" would invite trust it has not earned. This one means exactly what its
-- name says, and is null until a person says otherwise.
alter table received_payments
  add column if not exists cleared_at timestamptz;

comment on column received_payments.cleared_at is
  'When a person confirmed this money reached the bank. NOT a statement '
  'import — a manual confirmation. Null means recorded but unconfirmed.';

-- ── The report ───────────────────────────────────────────────────────────
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
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- ── Money in, per project ──────────────────────────────────────────────
  -- A draft invoice has not been sent to anyone and a cancelled one has been
  -- withdrawn; neither is money owed, so neither counts as invoiced.
  with per_project as (
    select p.id, p.name, p.status,
           coalesce(p.total_cost, 0) as project_value,
           coalesce((select sum(i.total) from invoices i
                      where i.project_id = p.id
                        and i.status not in ('draft', 'cancelled')), 0) as invoiced,
           coalesce((select sum(rp.amount) from received_payments rp
                      where rp.project_id = p.id and rp.status = 'paid'), 0) as received,
           coalesce((select sum(rp.amount) from received_payments rp
                      where rp.project_id = p.id and rp.status = 'paid'
                        and rp.cleared_at is not null), 0) as banked
      from projects p
     where p.company_id = v_company and p.status <> 'cancelled'
  )
  select jsonb_build_object(
    'project_value', coalesce(sum(project_value), 0),
    'invoiced',      coalesce(sum(invoiced), 0),
    'received',      coalesce(sum(received), 0),
    'banked',        coalesce(sum(banked), 0),
    -- Invoiced but not yet received: what a client still owes on a bill they
    -- have been sent.
    'outstanding',   coalesce(sum(greatest(invoiced - received, 0)), 0),
    -- Sold but never billed. Nothing in the app shows this today, and it is
    -- the quietest way a studio loses money: the work is done, the client
    -- would pay, and no one ever sent the invoice.
    'unbilled',      coalesce(sum(greatest(project_value - invoiced, 0)), 0),
    -- Recorded but not confirmed in the bank.
    'unbanked',      coalesce(sum(greatest(received - banked, 0)), 0),
    'projects', coalesce((
      select jsonb_agg(row_to_json(r) order by r.unbilled desc, r.outstanding desc)
        from (
          select id as project_id, name, status, project_value, invoiced, received, banked,
                 greatest(invoiced - received, 0) as outstanding,
                 greatest(project_value - invoiced, 0) as unbilled,
                 greatest(received - banked, 0) as unbanked
            from per_project
           -- Only rows with something to say; a settled project is noise here.
           where greatest(invoiced - received, 0) > 0
              or greatest(project_value - invoiced, 0) > 0
              or greatest(received - banked, 0) > 0
        ) r), '[]'::jsonb)
  ) into v_in
  from per_project;

  -- ── Money out, per member ──────────────────────────────────────────────
  -- Due is what the booking is costed at; a released or cancelled slot owes
  -- nobody. Settled is the signed ledger, so a reversal subtracts.
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
    -- Paid more than the booking was costed at. Usually an adjustment nobody
    -- recorded as one; always worth a look.
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

  -- ── Things that should never be true ───────────────────────────────────
  -- Each of these is a rule the schema or a trigger is supposed to hold. They
  -- are counted rather than trusted, so the screen notices the day one stops
  -- holding — which is the whole reason this page exists.
  select jsonb_build_object(
    -- The CHECK added in 0145 makes this impossible; a non-zero count means
    -- the constraint was dropped.
    'payments_linked_to_nothing', (
      select count(*) from received_payments
       where company_id = v_company and project_id is null and invoice_id is null),
    -- Invoice totals are derived by trigger since 0145.
    'invoices_paid_with_balance', (
      select count(*) from invoices
       where company_id = v_company and status = 'paid' and coalesce(balance_due, 0) > 0),
    'invoices_unpaid_but_settled', (
      select count(*) from invoices i
       where i.company_id = v_company and i.status in ('draft', 'sent')
         and coalesce(i.amount_paid, 0) > 0),
    -- Money recorded against a client who is not on the project it belongs to.
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
