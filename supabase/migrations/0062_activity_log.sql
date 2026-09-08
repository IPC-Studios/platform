-- Activity log: lightweight user activity trail across the CRM.
create table if not exists activity_log (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);
create index activity_log_company_idx on activity_log (company_id, created_at desc);
create index activity_log_user_idx on activity_log (user_id, created_at desc);
create index activity_log_entity_idx on activity_log (entity_type, entity_id);

alter table activity_log enable row level security;
create policy activity_log_select on activity_log for select to authenticated
  using (company_id = get_current_company_id());
create policy activity_log_insert on activity_log for insert to authenticated
  with check (company_id = get_current_company_id() and is_current_user_active());

comment on table activity_log is 'Lightweight activity feed tracking user actions across the CRM.';
