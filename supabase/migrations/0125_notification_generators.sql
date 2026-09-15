-- The 8 notification generators, plus the read side that 0103 shipped columns
-- and functions for but nothing ever called.
--
-- 0103 added severity / dismissed_at / deep_link / meta, dismiss_notification()
-- and unread_notifications_count(), and then no router route or UI referenced
-- any of it — the whole migration was dead. This one supplies the generators
-- those columns exist to feed, and the API exposes both.
--
-- Every generator is scoped to the CALLER's company (get_current_company_id),
-- dedupes through create_notification's dedupe_key, and supports a dry run that
-- counts what it would write without writing it. That combination is what makes
-- this safe to put behind a button a studio owner can press.

-- A generator notifies the people who can act. For studio-wide situations that
-- is every active admin/owner; for an assigned item it is the assignee.
create or replace function notification_admin_recipients(p_company uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id from users u
   where u.company_id = p_company
     and u.deleted_at is null
     and u.status = 'active'
     and u.role in ('super_admin', 'admin', 'manager');
$$;
revoke all on function notification_admin_recipients(uuid) from public, anon;
grant execute on function notification_admin_recipients(uuid) to authenticated, service_role;

/**
 * Run one generator.
 *
 * Returns {generated, deduped, scanned} — `scanned` is how many source rows
 * matched, `generated` how many notifications were actually new, `deduped` the
 * rest. On a dry run nothing is inserted and everything matched counts as
 * "would generate".
 */
create or replace function run_notification_generator(
  p_key      text,
  p_dry_run  boolean default true,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_date_to, now() + interval '30 days');
  v_scanned int := 0;
  v_generated int := 0;
  v_made boolean;
  r record;
begin
  if v_company is null then
    raise exception 'no company in context' using errcode = '42501';
  end if;

  if p_key = 'allocation_conflicts' then
    -- Two bookings for one person that overlap in time. `a.id < b.id` so each
    -- pair is reported once, not twice from both sides.
    for r in
      select a.user_id, a.id as slot_id, a.start_at, b.id as other_id
        from team_assignment_slots a
        join team_assignment_slots b
          on b.company_id = a.company_id and b.user_id = a.user_id and b.id > a.id
         and b.status = 'booked' and a.status = 'booked'
         and b.start_at < a.end_at and a.start_at < b.end_at
       where a.company_id = v_company and a.start_at between v_from and v_to
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'allocation.conflict',
          'Double booking', 'You are booked twice over the same hours.',
          'alloc_conflict:' || r.slot_id || ':' || r.other_id,
          'team_slot', r.slot_id, 'critical', '/team-allocation');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'reminders' then
    for r in
      select rm.id, rm.user_id, rm.title, rm.remind_at
        from reminders rm
       where rm.company_id = v_company and not rm.done
         and rm.remind_at between v_from and least(v_to, now())
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'reminder.due', 'Reminder due', r.title,
          'reminder_due:' || r.id, 'reminder', r.id, 'warning', '/reminders');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'tasks' then
    -- Overdue and unfinished, to whoever it is assigned to.
    for r in
      select t.id, t.title, t.due_date, ta.user_id
        from tasks t
        join task_assignees ta on ta.task_id = t.id
       where t.company_id = v_company
         and t.status <> 'done'
         and t.due_date is not null
         and t.due_date < current_date
         and t.due_date >= v_from::date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'task.overdue', 'Task overdue', r.title,
          'task_overdue:' || r.id || ':' || r.due_date, 'task', r.id, 'warning', '/tasks');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'shoots' then
    -- Upcoming shoots, to the crew booked on them.
    for r in
      select s.id, s.name, s.shoot_date, tas.user_id
        from shoots s
        join team_assignment_slots tas on tas.shoot_id = s.id and tas.status = 'booked'
       where s.company_id = v_company
         and s.status in ('planned', 'confirmed')
         and s.shoot_date is not null
         and s.shoot_date between current_date and least(v_to, now() + interval '7 days')::date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'shoot.upcoming', 'Shoot coming up',
          r.name || ' on ' || to_char(r.shoot_date, 'DD Mon'),
          'shoot_upcoming:' || r.id, 'shoot', r.id, 'info', '/shoots');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key in ('data_pending', 'backup_pending') then
    -- Same table, two independent custody tracks.
    for r in
      select d.id, d.data_label, u.user_id
        from shoot_data_records d
        cross join lateral notification_admin_recipients(v_company) u(user_id)
       where d.company_id = v_company
         and ((p_key = 'data_pending'   and d.primary_status = 'pending')
           or (p_key = 'backup_pending' and d.backup_status  = 'pending'))
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id,
          case when p_key = 'data_pending' then 'data.pending' else 'data.backup_pending' end,
          case when p_key = 'data_pending' then 'Data copy pending' else 'Backup pending' end,
          r.data_label, p_key || ':' || r.id, 'data_record', r.id, 'warning', '/data-management');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'payment_pending' then
    for r in
      select i.id, i.invoice_number, i.balance_due, i.due_date, u.user_id
        from invoices i
        cross join lateral notification_admin_recipients(v_company) u(user_id)
       where i.company_id = v_company
         and i.balance_due > 0
         and i.status <> 'cancelled'
         and i.due_date is not null
         and i.due_date < current_date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'invoice.overdue', 'Payment overdue',
          'Invoice ' || coalesce(r.invoice_number, '') || ' — ' || to_char(r.balance_due, 'FM999999990.00') || ' outstanding',
          'invoice_overdue:' || r.id || ':' || r.due_date, 'invoice', r.id, 'critical', '/billing');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'crm_follow_ups' then
    for r in
      select l.id, l.name, l.follow_up_at, l.assigned_to
        from crm_leads l
       where l.company_id = v_company
         and l.assigned_to is not null
         and l.status not in ('converted', 'lost')
         and l.follow_up_at is not null
         and l.follow_up_at < now()
         and l.follow_up_at >= v_from
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.assigned_to, 'crm.follow_up_overdue', 'Follow-up overdue',
          coalesce(r.name, 'A lead') || ' is past its follow-up time.',
          'lead_followup:' || r.id || ':' || date_trunc('day', r.follow_up_at),
          'crm_lead', r.id, 'warning', '/follow-ups');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  else
    raise exception 'unknown generator %', p_key using errcode = '22023';
  end if;

  return jsonb_build_object(
    'key', p_key,
    'dry_run', p_dry_run,
    'scanned', v_scanned,
    'generated', case when p_dry_run then 0 else v_generated end,
    'deduped', case when p_dry_run then 0 else v_scanned - v_generated end
  );
end;
$$;
revoke all on function run_notification_generator(text, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function run_notification_generator(text, boolean, timestamptz, timestamptz) to authenticated;
