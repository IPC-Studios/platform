-- Attendance enhancements: auto-attendance on login and streak tracking.
-- Compatible with attendance(a_date, check_in_at, check_out_at) and company_location(lat,lng,radius_m,timezone).
alter table attendance
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'auto_login', 'auto_checkout'));

-- RPC: auto check-in (called on login if auto-attendance is enabled)
create or replace function auto_check_in()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_user     uuid := auth.uid();
  v_loc      company_location;
  v_tz       text := 'Asia/Kolkata';
  v_today    date;
  v_existing uuid;
  v_id       uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_loc from company_location where company_id = v_company;
  if found then
    v_tz := coalesce(v_loc.timezone, 'Asia/Kolkata');
  end if;
  v_today := (now() at time zone v_tz)::date;

  -- Idempotent: already checked in today
  select id into v_existing from attendance
   where company_id = v_company and user_id = v_user and a_date = v_today
     and check_in_at is not null;
  if v_existing is not null then
    return v_existing;
  end if;

  -- If no location configured we still allow auto check-in (location is optional for auto)
  -- Insert auto check-in; on conflict do nothing and return existing
  insert into attendance (company_id, user_id, a_date, check_in_at, source, status)
  values (v_company, v_user, v_today, now(), 'auto_login', 'present')
  on conflict (company_id, user_id, a_date)
    do update set check_in_at = coalesce(attendance.check_in_at, excluded.check_in_at),
                  source = coalesce(attendance.source, 'auto_login')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function auto_check_in() from public, anon;
grant execute on function auto_check_in() to authenticated;

-- RPC: get attendance streak (consecutive days with check-in, Sundays ignored like old app)
create or replace function get_attendance_streak()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_user    uuid := auth.uid();
  v_tz      text := 'Asia/Kolkata';
  v_streak  int := 0;
  v_date    date;
  v_loc     company_location;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_loc from company_location where company_id = v_company;
  if found and v_loc.timezone is not null then
    v_tz := v_loc.timezone;
  end if;

  v_date := (now() at time zone v_tz)::date;
  -- Walk backwards; Sundays (dow=0) do not break streak and today missing is okay until cutoff
  loop
    -- Sunday: just step back, do not count or break
    if extract(dow from v_date) = 0 then
      v_date := v_date - 1;
      continue;
    end if;
    -- Today without check-in does NOT break streak (allow late check-in)
    if v_date = (now() at time zone v_tz)::date then
      if exists(select 1 from attendance where company_id=v_company and user_id=v_user and a_date=v_date and check_in_at is not null) then
        v_streak := v_streak + 1;
      end if;
      v_date := v_date - 1;
      continue;
    end if;
    exit when not exists(select 1 from attendance where company_id=v_company and user_id=v_user and a_date=v_date and check_in_at is not null);
    v_streak := v_streak + 1;
    v_date := v_date - 1;
    exit when v_streak > 365;
  end loop;

  return jsonb_build_object(
    'streak', v_streak,
    'last_check_date', (
      select a_date from attendance
       where company_id = v_company and user_id = v_user
         and check_in_at is not null
       order by a_date desc limit 1
    )
  );
end;
$$;

revoke all on function get_attendance_streak() from public, anon;
grant execute on function get_attendance_streak() to authenticated;

-- Add index for streak queries (a_date based)
create index if not exists attendance_user_date_idx
  on attendance (company_id, user_id, a_date desc);
