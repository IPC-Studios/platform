-- Lovable parity: terms rich payload + email logs + expiry/revoke.
-- Additive only.

alter table project_terms_documents add column if not exists title text;
alter table project_terms_documents add column if not exists payment_summary text;
alter table project_terms_documents add column if not exists sections jsonb not null default '[]'::jsonb;
alter table project_terms_documents add column if not exists expires_at timestamptz;
alter table project_terms_documents add column if not exists revoked_at timestamptz;
alter table project_terms_documents add column if not exists access_count int not null default 0;

create table if not exists project_terms_email_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  document_id uuid not null references project_terms_documents (id) on delete cascade,
  to_email    text,
  status      text not null default 'sent',
  error       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table project_terms_email_logs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'project_terms_email_logs_select') then
    create policy project_terms_email_logs_select on project_terms_email_logs for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'project_terms_email_logs_write') then
    create policy project_terms_email_logs_write on project_terms_email_logs for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- Rich public reader: full payload the Lovable terms-acknowledge page needs.
-- Keeps get_terms_for_token(text) single-text shape intact for backwards compat
-- (older clients call it); new readers should use get_terms_payload_for_token.
create or replace function get_terms_payload_for_token(p_raw text)
returns table (
  title text, body text, project_name text, client_name text, client_phone text,
  company_name text, logo_url text, company_phone text, company_email text, company_address text,
  payment_summary text, sections jsonb, expires_at timestamptz, revoked boolean,
  acknowledged_at timestamptz, acknowledged_by_name text, access_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_doc uuid;
begin
  select subject_id into v_doc from access_tokens
   where purpose = 'terms_ack'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and (expires_at is null or expires_at > now())
     and revoked_at is null
   limit 1;
  if v_doc is null then
    return;
  end if;
  update access_tokens set access_count = coalesce(access_count, 0) + 1
   where purpose = 'terms_ack'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  update project_terms_documents set access_count = coalesce(access_count, 0) + 1
   where id = v_doc;
  return query
  select d.title, d.rendered_body, p.name, cl.name, cl.phone,
         co.name, co.logo_url, co.phone, co.email, co.address,
         d.payment_summary, coalesce(d.sections, '[]'::jsonb), d.expires_at,
         (d.revoked_at is not null),
         d.acknowledged_at, d.acknowledged_by_name, coalesce(d.access_count, 0)
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = d.company_id
   where d.id = v_doc
     and d.revoked_at is null
     and (d.expires_at is null or d.expires_at > now());
end;
$$;

revoke all on function get_terms_payload_for_token(text) from public;
grant execute on function get_terms_payload_for_token(text) to anon, authenticated;
