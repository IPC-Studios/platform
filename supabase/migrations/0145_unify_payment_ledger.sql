-- One payment ledger.
--
-- There were two, and nothing joined them. `record_invoice_payment()` wrote
-- `invoice_payments` and updated the invoice's paid/balance/status. Every
-- project and profit figure in the system — project_financials.received,
-- monthly_profit_summary, gopo_summary, project_profitability_report — sums
-- `received_payments`. A grep of every migration and every API file found no
-- line that mentions both tables.
--
-- So: invoice a client ₹1,80,000, they pay, record it on the invoice, and the
-- project says "received ₹0, balance ₹1,80,000" while the month shows no cash
-- at all. Record it on the project instead and the invoice stays unpaid for
-- ever. Both screens are live, both are used, and neither is wrong on its own
-- terms — they are simply counting different rows.
--
-- `received_payments` becomes the ledger: it is the richer table (status, GST,
-- client, attachment, who recorded it) and it is what the money reports
-- already read. It gains `invoice_id`, so a payment can be against an
-- invoice, a project, or both.
--
-- The invoice's totals are no longer maintained by whoever happens to write a
-- payment. A trigger recomputes them from the ledger on every insert, update
-- and delete, which is what makes a second divergence impossible rather than
-- merely unlikely: there is one place the number comes from.

-- ── 1. A payment can point at an invoice ─────────────────────────────────
alter table received_payments
  add column if not exists invoice_id uuid references invoices (id) on delete set null;

create index if not exists received_payments_invoice_idx
  on received_payments (invoice_id) where invoice_id is not null;

-- An invoice need not belong to a project (invoices.project_id is nullable and
-- the form does not require it), so a payment against one may have no project.
alter table received_payments alter column project_id drop not null;

-- ...but it must be against *something*, or it is money from nowhere.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'received_payments_linked_check') then
    alter table received_payments add constraint received_payments_linked_check
      check (project_id is not null or invoice_id is not null);
  end if;
end $$;

-- ── 2. Bring the invoice payments across ─────────────────────────────────
-- Carrying the invoice's own project and client, so a payment recorded on an
-- invoice starts counting toward that project's figures — which is the whole
-- point of the change. `where not exists` keeps a re-run from doubling it.
--
-- One caveat, stated rather than silently handled: a studio that recorded the
-- same money twice, once on the invoice and once on the project, has two
-- genuine rows and will now see both. There is no safe way to tell that apart
-- from two real payments of the same amount on the same day, so nothing is
-- merged. To review them:
--
--   select project_id, amount, paid_on, count(*)
--     from received_payments group by 1,2,3 having count(*) > 1;
insert into received_payments
  (id, company_id, project_id, client_id, invoice_id, amount, paid_on,
   mode, reference, notes, status, is_gst, created_at)
select ip.id, ip.company_id, i.project_id, i.client_id, ip.invoice_id, ip.amount, ip.paid_on,
       ip.mode, ip.reference, ip.notes, 'paid', false, ip.created_at
  from invoice_payments ip
  join invoices i on i.id = ip.invoice_id
 where not exists (select 1 from received_payments rp where rp.id = ip.id);

-- ── 3. The invoice's totals come from the ledger, always ─────────────────
create or replace function recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  if p_invoice_id is null then return; end if;
  select total into v_total from invoices where id = p_invoice_id;
  if v_total is null then return; end if;
  -- Only money in hand. A row marked `pending` is a promise, which is what
  -- the payments screen calls "what is still pending" — an invoice settled by
  -- one of those would be reporting a payment nobody has received.
  select coalesce(sum(amount), 0) into v_paid
    from received_payments
   where invoice_id = p_invoice_id and status = 'paid';
  update invoices
     set amount_paid = v_paid,
         balance_due = greatest(0, v_total - v_paid),
         status = case when v_paid >= v_total then 'paid'
                       when v_paid > 0 then 'partial'
                       -- Back to its pre-payment state if every payment is
                       -- removed; 'sent' rather than 'draft', because an
                       -- invoice that has been paid was certainly sent.
                       else case when status in ('paid', 'partial') then 'sent' else status end
                  end
   where id = p_invoice_id;
end;
$$;

create or replace function received_payments_sync_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An edit can move a payment from one invoice to another, so both ends are
  -- recomputed. Doing only the new one leaves the old invoice overstated.
  if tg_op in ('UPDATE', 'DELETE') then
    perform recompute_invoice_totals(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id then
      perform recompute_invoice_totals(new.invoice_id);
    else
      -- Amount or status may have changed on the same invoice.
      perform recompute_invoice_totals(new.invoice_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists received_payments_sync_invoice_trg on received_payments;
create trigger received_payments_sync_invoice_trg
  after insert or update or delete on received_payments
  for each row execute function received_payments_sync_invoice();

-- Bring every existing invoice in line with the ledger it now reads.
do $$
declare v_id uuid;
begin
  for v_id in select id from invoices loop
    perform recompute_invoice_totals(v_id);
  end loop;
end $$;

-- ── 4. Recording a payment against an invoice writes the ledger ──────────
-- The totals update is gone from here: the trigger owns it now, so a payment
-- recorded from the project screen against the same invoice lands in exactly
-- the same state as one recorded from the invoice.
create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_paid_on    date default null,
  p_mode       text default null,
  p_reference  text default null,
  p_notes      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_inv     invoices;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_inv from invoices where id = p_invoice_id and company_id = v_company;
  if v_inv.id is null then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;

  insert into received_payments
    (company_id, invoice_id, project_id, client_id, amount, paid_on,
     mode, reference, notes, status, is_gst, recorded_by)
  values (v_company, p_invoice_id, v_inv.project_id, v_inv.client_id, p_amount,
          coalesce(p_paid_on, current_date), p_mode, p_reference,
          nullif(trim(p_notes), ''), 'paid', false, auth.uid());
end;
$$;

revoke all on function record_invoice_payment(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function record_invoice_payment(uuid, numeric, date, text, text, text) to authenticated;
revoke all on function recompute_invoice_totals(uuid) from public, anon;

comment on table invoice_payments is
  'SUPERSEDED (0145). Its rows were copied into received_payments, which is '
  'now the single payment ledger and carries invoice_id. Kept because a table '
  'drop cannot be undone — do not wire anything new to it.';

comment on table received_payments is
  'The payment ledger: every rupee a client has paid, against a project, an '
  'invoice, or both. Invoice totals are derived from it by trigger '
  '(received_payments_sync_invoice_trg), so they cannot drift.';
