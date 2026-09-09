-- Team payouts, shoot-derived tracker (kept alongside the existing manual
-- team_payouts table, not replacing it -- a studio still needs to log a
-- payout that isn't tied to any shoot, e.g. a fixed monthly salary).
--
-- The original had no manual payout entity at all: a "payout" was a live
-- view over team_assignment_slots (already carrying final_cost/cost_status
-- since 0008) joined with a cash-settlement ledger, cost (for profit) kept
-- deliberately separate from cash actually paid (for bookkeeping). This adds
-- that ledger and the missing cost-notes field; final_cost/cost_status/the
-- underlying booking already exist.

alter table team_assignment_slots add column if not exists cost_notes text;
alter table team_assignment_slots drop constraint if exists tas_cost_status_chk;
alter table team_assignment_slots add constraint tas_cost_status_chk
  check (cost_status in ('tentative', 'final', 'not_decided'));

create or replace function set_slot_cost(
  p_slot_id        uuid,
  p_estimated_cost numeric default null,
  p_final_cost     numeric default null,
  p_cost_status    text default null,
  p_cost_notes     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_cost_status is not null and p_cost_status not in ('tentative', 'final', 'not_decided') then
    raise exception 'invalid cost_status';
  end if;
  if p_estimated_cost is not null and p_estimated_cost < 0 then
    raise exception 'estimated_cost must not be negative';
  end if;
  if p_final_cost is not null and p_final_cost < 0 then
    raise exception 'final_cost must not be negative';
  end if;

  update team_assignment_slots set
    estimated_cost = coalesce(p_estimated_cost, estimated_cost),
    final_cost     = case when p_final_cost is not null then p_final_cost else final_cost end,
    cost_status    = coalesce(p_cost_status, cost_status),
    cost_notes     = case when p_cost_notes is not null then nullif(trim(p_cost_notes), '') else cost_notes end
  where id = p_slot_id and company_id = get_current_company_id();

  if not found then
    raise exception 'slot not found' using errcode = '42501';
  end if;
end;
$$;

revoke all on function set_slot_cost(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function set_slot_cost(uuid, numeric, numeric, text, text) to authenticated;

-- Cash ledger. This is a settlement tracker only -- it never mutates
-- team_assignment_slots and never feeds project cost/profit, which read
-- final_cost/estimated_cost directly, same as before this migration.
create table if not exists team_slot_settlements (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies (id) on delete cascade,
  slot_id                uuid not null references team_assignment_slots (id) on delete restrict,
  member_uid             uuid not null references users (user_id) on delete cascade,
  project_id             uuid references projects (id) on delete set null,
  shoot_id               uuid references shoots (id) on delete set null,
  -- Snapshotted from the slot's cost at the moment of this entry, not a running column.
  amount_due             numeric(12, 2) not null default 0,
  -- Signed: positive for a payment or adjustment, negative for a reversal.
  amount_paid            numeric(12, 2) not null default 0,
  paid_date              date not null default current_date,
  payment_mode           text,
  payment_reference      text,
  notes                  text,
  entry_type             text not null default 'payment'
                           check (entry_type in ('payment', 'reversal', 'adjustment')),
  reverses_settlement_id uuid references team_slot_settlements (id) on delete set null,
  created_by             uuid references auth.users (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index tps_company_idx on team_slot_settlements (company_id);
create index tps_slot_idx on team_slot_settlements (slot_id);
create index tps_member_idx on team_slot_settlements (member_uid);
create index tps_paid_date_idx on team_slot_settlements (paid_date);
drop trigger if exists tps_set_updated_at on team_slot_settlements;
create trigger tps_set_updated_at before update on team_slot_settlements
  for each row execute function set_updated_at();

alter table team_slot_settlements enable row level security;
create policy tps_select on team_slot_settlements for select to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager());
create policy tps_write on team_slot_settlements for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

-- RPC: record a payment (full/partial), a reversal, or a manual adjustment.
-- amount_due is recomputed fresh from the slot each time, not stored on it.
create or replace function create_payout_settlement(
  p_slot_id               uuid,
  p_amount_paid           numeric,
  p_paid_date             date default current_date,
  p_payment_mode          text default null,
  p_payment_reference     text default null,
  p_notes                 text default null,
  p_entry_type            text default 'payment',
  p_reverses_settlement_id uuid default null
)
returns table (id uuid, paid_total numeric, amount_due numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company        uuid := get_current_company_id();
  v_slot           team_assignment_slots;
  v_amount_due     numeric;
  v_current_paid   numeric;
  v_delta          numeric;
  v_projected      numeric;
  v_project_id     uuid;
  v_id             uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_entry_type not in ('payment', 'reversal', 'adjustment') then
    raise exception 'invalid entry_type';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'amount_paid must be > 0';
  end if;

  select * into v_slot from team_assignment_slots
   where team_assignment_slots.id = p_slot_id and company_id = v_company;
  if v_slot.id is null then
    raise exception 'slot not found' using errcode = '42501';
  end if;

  v_amount_due := coalesce(v_slot.final_cost, v_slot.estimated_cost, 0);
  select project_id into v_project_id from shoots where shoots.id = v_slot.shoot_id;

  select coalesce(sum(amount_paid), 0) into v_current_paid
    from team_slot_settlements where slot_id = p_slot_id;

  v_delta := case when p_entry_type = 'reversal' then -p_amount_paid else p_amount_paid end;
  v_projected := v_current_paid + v_delta;

  if p_entry_type = 'reversal' and v_projected < 0 then
    raise exception 'reversal would make the paid total negative';
  end if;
  if p_entry_type = 'payment' and v_amount_due > 0 and v_projected > v_amount_due + 0.001 then
    raise exception 'payment would exceed amount due (%)', v_amount_due;
  end if;

  insert into team_slot_settlements (
    company_id, slot_id, member_uid, project_id, shoot_id,
    amount_due, amount_paid, paid_date, payment_mode, payment_reference, notes,
    entry_type, reverses_settlement_id, created_by
  ) values (
    v_company, p_slot_id, v_slot.user_id, v_project_id, v_slot.shoot_id,
    v_amount_due, v_delta, coalesce(p_paid_date, current_date), p_payment_mode, p_payment_reference, p_notes,
    p_entry_type, p_reverses_settlement_id, auth.uid()
  ) returning team_slot_settlements.id into v_id;

  return query select v_id, v_projected, v_amount_due;
end;
$$;

revoke all on function create_payout_settlement(uuid, numeric, date, text, text, text, text, uuid) from public, anon;
grant execute on function create_payout_settlement(uuid, numeric, date, text, text, text, text, uuid) to authenticated;

-- RPC: settlement entries + a paid-total-per-slot aggregate, optionally scoped to a slot list.
create or replace function list_payout_settlements(p_slot_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_result  jsonb;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(row_to_json(e) order by e.created_at desc)
      from (
        select id, slot_id, member_uid, project_id, shoot_id, amount_due, amount_paid,
               paid_date, payment_mode, payment_reference, notes, entry_type,
               reverses_settlement_id, created_by, created_at
          from team_slot_settlements
         where company_id = v_company
           and (p_slot_ids is null or slot_id = any(p_slot_ids))
      ) e
    ), '[]'::jsonb),
    'aggregates', coalesce((
      select jsonb_agg(row_to_json(a))
      from (
        select slot_id,
               round(sum(amount_paid)::numeric, 2) as paid_total,
               max(paid_date) filter (where entry_type = 'payment') as last_paid_date,
               (array_agg(payment_reference order by paid_date desc) filter (where entry_type = 'payment'))[1] as last_reference,
               count(*)::int as entries_count
          from team_slot_settlements
         where company_id = v_company
           and (p_slot_ids is null or slot_id = any(p_slot_ids))
         group by slot_id
      ) a
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function list_payout_settlements(uuid[]) from public, anon;
grant execute on function list_payout_settlements(uuid[]) to authenticated;
