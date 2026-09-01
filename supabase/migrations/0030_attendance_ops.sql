-- Attendance, phase 2: closing the day, and setting the fence from the app.
--
-- 0014 gave every member a way in (check_in) but no way out: check_out_at sat
-- unwritable, so "still checked in" could never become "went home" and the
-- stale-sealing job had nothing to seal against. The fence itself was equally
-- stranded — company_location could be read but only ever written by hand.

-- ── check_out ─────────────────────────────────────────────────
-- Stamps today's row, where "today" is the company's own timezone rather than
-- the server's. A member checking out at 00:30 is closing yesterday's shift,
-- and a_date has to agree with the row check_in created.
create or replace function check_out()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_tz      text := coalesce(
    (select timezone from company_location where company_id = v_company),
    'Asia/Kolkata'
  );
  v_date    date := (now() at time zone v_tz)::date;
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update attendance
     set check_out_at = now()
   where company_id = v_company
     and user_id = auth.uid()
     and a_date = v_date
     and check_in_at is not null
     -- Only an OPEN shift can be closed. Without this, a second tap silently
     -- overwrites the first check-out time and the hours worked change.
     and check_out_at is null
  returning id into v_id;

  if v_id is null then
    -- Either they never checked in today, or they already left. Both are the
    -- caller's problem to explain, not something to paper over with a row.
    raise exception 'no_open_check_in: nothing to check out of today'
      using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;

revoke all on function check_out() from public, anon;
grant execute on function check_out() to authenticated;

-- ── the fence, set from the app ───────────────────────────────
-- Owner-only, enforced by the company_location RLS policy 0014 already wrote —
-- this runs as the caller precisely so that policy still applies.
create or replace function set_company_location(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m int  default 150,
  p_timezone text default 'Asia/Kolkata'
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

  insert into company_location (company_id, lat, lng, radius_m, timezone)
  values (v_company, p_lat, p_lng, p_radius_m, p_timezone)
  on conflict (company_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        radius_m = excluded.radius_m, timezone = excluded.timezone
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function set_company_location(double precision, double precision, int, text)
  from public, anon;
grant execute on function set_company_location(double precision, double precision, int, text)
  to authenticated;
