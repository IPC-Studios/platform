-- Lovable parity: terms email log + lifecycle helpers.
-- Additive only.
create table if not exists terms_email_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  document_id uuid references project_terms_documents (id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'sent' check (status in ('draft','sent','failed')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists terms_email_logs_company_idx on terms_email_logs (company_id, document_id);

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='project_terms_documents' and column_name='revoked_at') then
    alter table project_terms_documents add column revoked_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='project_terms_documents' and column_name='sent_at') then
    alter table project_terms_documents add column sent_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='project_terms_documents' and column_name='email_status') then
    alter table project_terms_documents add column email_status text;
  end if;
end $$;

alter table terms_email_logs enable row level security;
do $$
declare t text := 'terms_email_logs';
begin
  if not exists (select 1 from pg_policies where tablename = t and policyname = 'terms_email_logs_select') then
    execute format('create policy %I_select on %I for select to authenticated using (company_id = get_current_company_id());', t, t);
  end if;
  if not exists (select 1 from pg_policies where tablename = t and policyname = 'terms_email_logs_write') then
    execute format('create policy %I_write on %I for all to authenticated using (company_id = get_current_company_id() and is_current_user_active()) with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
  end if;
end $$;
