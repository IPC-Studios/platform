-- mark_absent_backstop() returned the wrong number, and nothing called it.
--
-- The function has existed since 0014: at the end of a working day it writes
-- an `absent` row for every active member who has no attendance row for that
-- date, so a day nobody touched is recorded as absent rather than as nothing
-- at all. It is granted to service_role and covered by a test — and no cron
-- job, no endpoint and no screen has ever invoked it, so no studio has ever
-- had an absent day written. `POST /cron/attendance` calls it now.
--
-- The counter bug: `get diagnostics v_count = row_count` sat INSIDE the loop
-- over companies, so each company overwrote the last one's figure and the
-- function returned however many rows the final company happened to get —
-- usually 0, since most companies have nobody missing. The cron log would
-- have reported "0 absences written" on a night it wrote fifty.
--
-- Behaviour is otherwise unchanged: still today's date in each company's own
-- timezone, still `on conflict do nothing`, so running it twice in a night is
-- as harmless as running it once. Check-in continues to flip an absent row to
-- present (0014), which is what makes an early run recoverable.

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
  v_added   int := 0;
  v_total   int := 0;
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
    get diagnostics v_added = row_count;
    v_total := v_total + v_added;
  end loop;
  return v_total;
end;
$$;

revoke all on function mark_absent_backstop() from public, anon;
grant execute on function mark_absent_backstop() to service_role;
