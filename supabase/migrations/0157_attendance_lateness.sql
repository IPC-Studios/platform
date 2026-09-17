-- Nobody can ever be late.
--
-- attendance.status has allowed 'late' since 0014 and the attendance page
-- offers a Late filter — but check_in() writes 'present' unconditionally and
-- there is nothing to compare a check-in against, so the only way a row can
-- say 'late' is an admin setting it by hand. For every studio using the
-- geofence, that filter is a control that returns nothing, for ever.
--
-- The original app had the missing half on company_location:
--
--     expected_checkin_time  time     default '10:00'
--     late_grace_minutes     integer  default 15
--     missed_cutoff_time     time     default '12:00'
--
-- and stamped is_late / late_minutes on the attendance row at check-in.
--
-- One detail of its rule is worth keeping deliberately rather than
-- rediscovering: lateness is DECIDED against expected + grace, but MEASURED
-- from expected. Someone arriving at 10:20 with a 15-minute grace is late by
-- twenty minutes, not five. The grace is forgiveness for being a little late,
-- not a redefinition of the start of the day — and a studio that later reduces
-- the grace to zero sees the same minutes, not different ones.
--
-- missed_cutoff_time is not enforced here. It says when a day with no check-in
-- stops being "not in yet" and starts being "did not come" — a reporting
-- boundary, and the nightly mark_absent_backstop() already writes the absent
-- row. It is stored so the read side can use it and so the studio configures
-- one thing rather than two.

-- Nullable, and no default start time. This matters more than it looks.
--
-- Every studio already using the geofence has a company_location row. Giving
-- expected_checkin_time a NOT NULL DEFAULT of '10:00' would mean that the
-- moment this migration lands, every one of them starts marking staff late
-- against a 10am start nobody chose — a silent change to what their attendance
-- records mean, applied retroactively to how they read.
--
-- Null means "this studio has not declared a start of day", and nobody can be
-- late for a day that has no declared start. Lateness begins when the owner
-- fills the field in, and not before.
alter table company_location
  add column if not exists expected_checkin_time time,
  add column if not exists late_grace_minutes    int not null default 15
    check (late_grace_minutes between 0 and 240),
  add column if not exists missed_cutoff_time    time;

-- How late, in minutes, measured from expected_checkin_time. 0 for anyone on
-- time. `status` already carries the yes/no, so there is no separate is_late
-- flag to disagree with it.
alter table attendance
  add column if not exists late_minutes int not null default 0
    check (late_minutes >= 0);

/**
 * Minutes past the expected start, and whether that counts as late.
 *
 * Split out of check_in() so the rule has one home: the read side needs the
 * same arithmetic to say "is this person late right now", and two copies of a
 * clock comparison is how the two ends of a feature start disagreeing.
 */
create or replace function attendance_lateness(
  p_checked_in_at timestamptz,
  p_expected      time,
  p_grace         int,
  p_tz            text
)
returns int
language sql
immutable
as $$
  with t as (
    select extract(epoch from ((p_checked_in_at at time zone p_tz)::time - p_expected)) / 60 as mins
  )
  -- No declared start of day means nobody is late.
  select case
           when p_expected is null then 0
           -- Decided against expected + grace, measured from expected.
           when t.mins > greatest(coalesce(p_grace, 0), 0) then ceil(t.mins)::int
           else 0
         end
  from t;
$$;

revoke all on function attendance_lateness(timestamptz, time, int, text) from public, anon;
grant execute on function attendance_lateness(timestamptz, time, int, text) to authenticated, service_role;

-- ── check_in, now with a verdict ─────────────────────────────
-- Based on 0079's body, NOT 0014's. The difference is `v_loc.is_active and`
-- on the fence test — the toggle that lets a studio suspend the geofence for a
-- shoot day without deleting it. Rebuilding this from the older version
-- silently removed that, and the tenancy suite caught it: exactly the failure
-- 0154 documents, where 0139 rewrote a function from a stale copy and dropped
-- four picklists nobody noticed for months.
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
  v_late    int := 0;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_loc from company_location where company_id = v_company;
  if found then
    v_tz := v_loc.timezone;
    if v_loc.is_active and geo_distance_m(p_lat, p_lng, v_loc.lat, v_loc.lng) > v_loc.radius_m then
      raise exception 'outside_fence: you are too far from the studio to check in'
        using errcode = 'P0001';
    end if;
    -- Null expected time => 0. A studio that has not set a start of day is
    -- unaffected by this migration.
    v_late := attendance_lateness(now(), v_loc.expected_checkin_time, v_loc.late_grace_minutes, v_tz);
  end if;

  v_date := (now() at time zone v_tz)::date;

  insert into attendance (company_id, user_id, a_date, check_in_at, check_in_lat, check_in_lng,
                          status, late_minutes)
    values (v_company, auth.uid(), v_date, now(), p_lat, p_lng,
            case when v_late > 0 then 'late' else 'present' end, v_late)
  on conflict (company_id, user_id, a_date)
    do update set check_in_at = coalesce(attendance.check_in_at, excluded.check_in_at),
                  check_in_lat = excluded.check_in_lat, check_in_lng = excluded.check_in_lng,
                  -- A second check-in on the same day must not relabel the
                  -- first one. The arrival that counts is the one already
                  -- recorded, so the verdict and the minutes stay with it —
                  -- except for an 'absent' row the backstop wrote, which this
                  -- check-in is correcting.
                  status = case
                             when attendance.status = 'absent' then excluded.status
                             else attendance.status
                           end,
                  late_minutes = case
                                   when attendance.status = 'absent' then excluded.late_minutes
                                   else attendance.late_minutes
                                 end
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function check_in(double precision, double precision) from public, anon;
grant execute on function check_in(double precision, double precision) to authenticated;

-- ── The studio has to be able to set the three new values ────
-- The argument list grows, and `create or replace` cannot change one: it would
-- leave the 5-argument version beside the new one and the router's call would
-- become ambiguous (42725). 0150 nearly took the nightly cron down that exact
-- way. So the old signature is dropped first, by its full argument list.
drop function if exists set_company_location(double precision, double precision, int, text, boolean);
drop function if exists set_company_location(double precision, double precision, int, text);

create or replace function set_company_location(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_m   int     default 150,
  p_timezone   text    default 'Asia/Kolkata',
  p_is_active  boolean default true,
  p_expected   time    default null,
  p_grace      int     default 15,
  p_cutoff     time    default null
)
returns company_location
language plpgsql
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_row     company_location;
begin
  if p_radius_m < 20 or p_radius_m > 5000 then
    -- Under 20m and GPS drift alone locks people out; over 5km is not a fence.
    raise exception 'radius must be between 20 and 5000 metres' using errcode = '22023';
  end if;
  if p_grace < 0 or p_grace > 240 then
    raise exception 'grace must be between 0 and 240 minutes' using errcode = '22023';
  end if;
  -- A cutoff before the expected start would make every day "missed" the
  -- moment it began. Only checked when both are set — a studio can leave the
  -- working day undeclared and keep just the geofence.
  if p_cutoff is not null and p_expected is not null and p_cutoff <= p_expected then
    raise exception 'the missed-check-in cutoff must be after the expected start time'
      using errcode = '22023';
  end if;

  insert into company_location (company_id, lat, lng, radius_m, timezone, is_active,
                                expected_checkin_time, late_grace_minutes, missed_cutoff_time)
  values (v_company, p_lat, p_lng, p_radius_m, p_timezone, p_is_active,
          p_expected, p_grace, p_cutoff)
  on conflict (company_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        radius_m = excluded.radius_m, timezone = excluded.timezone,
        is_active = excluded.is_active,
        expected_checkin_time = excluded.expected_checkin_time,
        late_grace_minutes = excluded.late_grace_minutes,
        missed_cutoff_time = excluded.missed_cutoff_time
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function set_company_location(double precision, double precision, int, text, boolean, time, int, time)
  from public, anon;
grant execute on function set_company_location(double precision, double precision, int, text, boolean, time, int, time)
  to authenticated;
