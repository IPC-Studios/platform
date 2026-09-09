-- The original app let a studio suspend geofence enforcement without
-- deleting the saved location ("when off, check-in still works but
-- location is not validated") -- useful for a shoot day away from the
-- studio, or while the location is being re-measured. The rebuild had no
-- such toggle: a saved location was always enforced.
alter table company_location add column if not exists is_active boolean not null default true;

drop function if exists set_company_location(double precision, double precision, int, text);

create or replace function set_company_location(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  int  default 150,
  p_timezone  text default 'Asia/Kolkata',
  p_is_active boolean default true
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

  insert into company_location (company_id, lat, lng, radius_m, timezone, is_active)
  values (v_company, p_lat, p_lng, p_radius_m, p_timezone, p_is_active)
  on conflict (company_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        radius_m = excluded.radius_m, timezone = excluded.timezone,
        is_active = excluded.is_active
  returning * into v_row;

  return v_row;
end;
$$;

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
    if v_loc.is_active and geo_distance_m(p_lat, p_lng, v_loc.lat, v_loc.lng) > v_loc.radius_m then
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
