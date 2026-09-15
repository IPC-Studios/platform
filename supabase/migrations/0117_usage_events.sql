-- Lovable parity: usage heartbeat events. Separate from activity_log (do NOT conflate).
-- One row per heartbeat/route-view; platform console aggregates from here.

create table if not exists usage_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  session_id  text not null,
  route       text,
  module      text not null default 'other',
  event_name  text not null default 'route_viewed',
  user_agent  text,
  device_type text,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists usage_events_company_time_idx on usage_events (company_id, occurred_at desc);
create index if not exists usage_events_session_idx on usage_events (session_id);
alter table usage_events enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'usage_events_select') then
    create policy usage_events_select on usage_events for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'usage_events_write') then
    create policy usage_events_write on usage_events for insert to authenticated
      with check (company_id = get_current_company_id());
  end if;
end $$;

-- Detailed platform usage rollup for the usage console (per-studio + funnel).
create or replace function platform_usage_detailed(p_days int default 30)
returns table (
  company_id uuid, company_name text, owner_email text,
  active_today bigint, active_week bigint, active_month bigint,
  sessions_30d bigint, events_30d bigint, last_seen timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name,
         (select u.email from users u where u.user_id = c.owner_user_id),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - interval '1 day'),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - interval '7 days'),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - interval '30 days'),
         (select count(distinct ue.session_id) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - make_interval(days => p_days)),
         (select count(*) from usage_events ue
           where ue.company_id = c.id and ue.occurred_at > now() - make_interval(days => p_days)),
         (select max(ue.occurred_at) from usage_events ue where ue.company_id = c.id) as last_seen
    from companies c
   order by last_seen desc nulls last
   limit 500;
$$;

revoke all on function platform_usage_detailed(int) from public, anon;
grant execute on function platform_usage_detailed(int) to authenticated;
