-- 0102: Notifications parity — severity, dismissed state, deep links, meta.
-- Additive, idempotent. Lovable filters (severity/dismissed/type_prefix/date)
-- and the bell's unread count read these columns.

alter table notifications
  add column if not exists severity text not null default 'info'
    check (severity in ('info', 'warning', 'critical')),
  add column if not exists dismissed_at timestamptz,
  add column if not exists deep_link text check (deep_link is null or char_length(deep_link) <= 300),
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists notifications_severity_idx
  on notifications (company_id, recipient_uid, severity, created_at desc);
create index if not exists notifications_dismissed_idx
  on notifications (company_id, recipient_uid, created_at desc)
  where dismissed_at is null;
create index if not exists notifications_type_idx
  on notifications (company_id, recipient_uid, type, created_at desc);

-- Dismiss is a timestamp, not a delete — the history stays queryable.
create or replace function dismiss_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := get_current_company_id();
begin
  update notifications
     set dismissed_at = coalesce(dismissed_at, now())
   where id = p_id and company_id = v_company and recipient_uid = auth.uid();
  return found;
end;
$$;
revoke all on function dismiss_notification(uuid) from public, anon;
grant execute on function dismiss_notification(uuid) to authenticated;

-- Unread = not read and not dismissed. One number for the bell.
create or replace function unread_notifications_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from notifications
   where company_id = get_current_company_id()
     and recipient_uid = auth.uid()
     and read_at is null
     and dismissed_at is null;
$$;
revoke all on function unread_notifications_count() from public, anon;
grant execute on function unread_notifications_count() to authenticated;

-- create_notification gains severity/deep_link/meta without breaking the
-- 8-arg callers: new params default, old calls keep working.
drop function if exists create_notification(uuid, uuid, text, text, text, text, text, uuid);
create or replace function create_notification(
  p_company_id uuid,
  p_recipient  uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_dedupe_key text,
  p_entity_type text default null,
  p_entity_id  uuid default null,
  p_severity   text default 'info',
  p_deep_link  text default null,
  p_meta       jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_rows int;
begin
  insert into notifications (company_id, recipient_uid, type, title, body, dedupe_key,
                             entity_type, entity_id, severity, deep_link, meta)
    values (p_company_id, p_recipient, p_type, p_title, p_body, p_dedupe_key,
            p_entity_type, p_entity_id,
            case when p_severity in ('info', 'warning', 'critical') then p_severity else 'info' end,
            p_deep_link, coalesce(p_meta, '{}'::jsonb))
  on conflict (company_id, recipient_uid, dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function create_notification(uuid, uuid, text, text, text, text, text, uuid, text, text, jsonb) from public, anon;
grant execute on function create_notification(uuid, uuid, text, text, text, text, text, uuid, text, text, jsonb) to authenticated, service_role, anon;
