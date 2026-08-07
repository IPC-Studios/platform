-- Phase 12: HR — attendance (geo-fenced, timezone-correct a_date), compensation,
-- monthly salary generation, and a ledger-style payout settlement.
-- Manager check-in anomaly resolved: ANY active member checks in for themselves.

create table company_location (
  company_id uuid primary key references companies (id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  radius_m   int not null default 150,
  timezone   text not null default 'Asia/Kolkata'
);

create table attendance (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references users (user_id) on delete cascade,
  a_date        date not null,
  check_in_at   timestamptz,
  check_out_at  timestamptz,
  check_in_lat  double precision,
  check_in_lng  double precision,
  status        text not null default 'present' check (status in ('present', 'late', 'absent')),
  created_at    timestamptz not null default now(),
  unique (company_id, user_id, a_date)
);
create index attendance_company_date_idx on attendance (company_id, a_date);

create table employee_compensation_profiles (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  user_id        uuid not null references users (user_id) on delete cascade,
  base_monthly   numeric(12, 2) not null default 0,
  per_shoot_rate numeric(12, 2) not null default 0,
  created_at     timestamptz not null default now(),
  unique (company_id, user_id)
);

create table monthly_salaries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  user_id      uuid not null references users (user_id) on delete cascade,
  month        date not null,   -- first of the month
  gross        numeric(12, 2) not null default 0,
  deductions   numeric(12, 2) not null default 0,
  net          numeric(12, 2) not null default 0,
  status       text not null default 'draft' check (status in ('draft', 'finalised', 'paid')),
  generated_at timestamptz not null default now(),
  unique (company_id, user_id, month)
);

-- Ledger: credits (owed), debits (paid), reversals. Balance = sum(amount).
create table team_payout_settlements (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  user_id    uuid not null references users (user_id) on delete cascade,
  amount     numeric(12, 2) not null,   -- signed: + credit owed, - paid out
  kind       text not null check (kind in ('credit', 'debit', 'reversal')),
  reference  text,
  note       text,
  created_at timestamptz not null default now()
);
create index tps_user_idx on team_payout_settlements (company_id, user_id);

alter table company_location               enable row level security;
alter table attendance                     enable row level security;
alter table employee_compensation_profiles enable row level security;
alter table monthly_salaries               enable row level security;
alter table team_payout_settlements        enable row level security;

create policy company_location_select on company_location
  for select to authenticated using (company_id = get_current_company_id());
create policy company_location_write on company_location
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());

-- Attendance: members see their own; admin/manager see all.
create policy attendance_select on attendance
  for select to authenticated
  using (company_id = get_current_company_id()
         and (is_current_admin_or_manager() or user_id = auth.uid()));

-- Comp/salary/payouts are sensitive: owner-only read (API also gates).
do $$
declare t text;
begin
  foreach t in array array['employee_compensation_profiles','monthly_salaries','team_payout_settlements']
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id() and is_current_owner());', t, t);
  end loop;
end $$;

-- ── Geo distance (metres) ─────────────────────────────────────
create or replace function geo_distance_m(lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ── Self check-in (geo-fenced) ────────────────────────────────
create or replace function check_in(p_lat double precision, p_lng double precision)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_loc     company_location;
  v_tz      text := 'Asia/Kolkata';
  v_date    date;
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_loc from company_location where company_id = v_company;
  if found then
    v_tz := v_loc.timezone;
    if geo_distance_m(p_lat, p_lng, v_loc.lat, v_loc.lng) > v_loc.radius_m then
      raise exception 'outside_fence: you are too far from the studio to check in'
        using errcode = 'P0001';
    end if;
  end if;

  v_date := (now() at time zone v_tz)::date;

  insert into attendance (company_id, user_id, a_date, check_in_at, check_in_lat, check_in_lng, status)
    values (v_company, auth.uid(), v_date, now(), p_lat, p_lng, 'present')
  on conflict (company_id, user_id, a_date)
    do update set check_in_at = coalesce(attendance.check_in_at, excluded.check_in_at),
                  check_in_lat = excluded.check_in_lat, check_in_lng = excluded.check_in_lng,
                  status = case when attendance.status = 'absent' then 'present' else attendance.status end
    returning id into v_id;
  return v_id;
end;
$$;

-- ── Absent backstop (cron; iterates all tenants) ──────────────
create or replace function mark_absent_backstop()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company companies;
  v_tz      text;
  v_date    date;
  v_count   int := 0;
begin
  for v_company in select * from companies loop
    select timezone into v_tz from company_location where company_id = v_company.id;
    v_tz := coalesce(v_tz, 'Asia/Kolkata');
    v_date := (now() at time zone v_tz)::date;
    insert into attendance (company_id, user_id, a_date, status)
      select v_company.id, u.user_id, v_date, 'absent'
      from users u
      where u.company_id = v_company.id and u.deleted_at is null and u.status = 'active'
        and not exists (
          select 1 from attendance a
          where a.company_id = v_company.id and a.user_id = u.user_id and a.a_date = v_date
        )
      on conflict (company_id, user_id, a_date) do nothing;
    get diagnostics v_count = row_count;
  end loop;
  return v_count;
end;
$$;

-- ── Payout ledger + balance ───────────────────────────────────
create or replace function settle_payout(
  p_user_id   uuid,
  p_amount    numeric,
  p_kind      text,
  p_reference text default null,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('credit', 'debit', 'reversal') then
    raise exception 'invalid kind';
  end if;
  insert into team_payout_settlements (company_id, user_id, amount, kind, reference, note)
    values (get_current_company_id(), p_user_id, p_amount, p_kind, p_reference, p_note);
end;
$$;

create or replace function payout_balance(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0) from team_payout_settlements
  where company_id = get_current_company_id() and user_id = p_user_id
$$;

revoke all on function check_in(double precision, double precision) from public, anon;
revoke all on function mark_absent_backstop()                       from public, anon;
revoke all on function settle_payout(uuid, numeric, text, text, text) from public, anon;
revoke all on function payout_balance(uuid)                          from public, anon;
grant execute on function check_in(double precision, double precision) to authenticated;
grant execute on function settle_payout(uuid, numeric, text, text, text) to authenticated;
grant execute on function payout_balance(uuid)                          to authenticated;
grant execute on function mark_absent_backstop() to service_role;
