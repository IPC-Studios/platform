-- Team payouts: settlement management for team members.
create table if not exists team_payouts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references users (user_id) on delete cascade,
  amount        numeric(12, 2) not null check (amount > 0),
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'completed', 'failed')),
  payment_mode  text,
  reference     text,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index team_payouts_company_idx on team_payouts (company_id, user_id, status);
create index team_payouts_period_idx on team_payouts (company_id, period_start, period_end);
drop trigger if exists team_payouts_set_updated_at on team_payouts;
create trigger team_payouts_set_updated_at before update on team_payouts
  for each row execute function set_updated_at();

alter table team_payouts enable row level security;
create policy team_payouts_select on team_payouts for select to authenticated
  using (company_id = get_current_company_id());
create policy team_payouts_write on team_payouts for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- RPC: create a team payout
create or replace function create_team_payout(
  p_user_id      uuid,
  p_amount       numeric,
  p_period_start date,
  p_period_end   date,
  p_payment_mode text default null,
  p_reference    text default null,
  p_notes        text default null
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
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into team_payouts (company_id, user_id, amount, period_start, period_end, payment_mode, reference, notes, created_by)
  values (v_company, p_user_id, p_amount, p_period_start, p_period_end, p_payment_mode, p_reference, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function create_team_payout(uuid, numeric, date, date, text, text, text) from public, anon;
grant execute on function create_team_payout(uuid, numeric, date, date, text, text, text) to authenticated;
