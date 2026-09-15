-- Lovable parity: quotation snapshot extras (branding/shoots schedule/terms/prefs/expiry/gate).
-- Additive only.

alter table project_quotations add column if not exists branding_snapshot jsonb;
alter table project_quotations add column if not exists shoots_schedule jsonb not null default '[]'::jsonb;
alter table project_quotations add column if not exists terms_text text;
alter table project_quotations add column if not exists display_prefs jsonb not null default '{}'::jsonb;
alter table project_quotations add column if not exists show_quotation boolean not null default true;
alter table project_quotations add column if not exists expires_at timestamptz;
alter table project_quotations add column if not exists revoked_at timestamptz;
alter table project_quotations add column if not exists access_count int not null default 0;

-- Quotation email log (studio-side audit of send-quotation-email).
create table if not exists quotation_email_logs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  quotation_id uuid not null references project_quotations (id) on delete cascade,
  to_email     text,
  status       text not null default 'sent',
  error        text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table quotation_email_logs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'quotation_email_logs_select') then
    create policy quotation_email_logs_select on quotation_email_logs for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'quotation_email_logs_write') then
    create policy quotation_email_logs_write on quotation_email_logs for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- Extended public quotation reader. Old columns preserved; new ones appended.
drop function if exists get_quotation_for_token(text);
create or replace function get_quotation_for_token(p_raw text)
returns table (
  snapshot jsonb, notes text, accepted_at timestamptz, accepted_by_name text,
  declined_at timestamptz, client_name text, company_name text,
  logo_url text, company_phone text, company_email text, company_address text, gstin text,
  shoots_schedule jsonb, terms_text text, display_prefs jsonb,
  show_quotation boolean, expires_at timestamptz, revoked boolean, access_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_quote uuid;
begin
  select subject_id into v_quote from access_tokens
   where purpose = 'quotation'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and (expires_at is null or expires_at > now())
     and revoked_at is null
   limit 1;
  if v_quote is null then
    return;
  end if;
  update access_tokens set access_count = coalesce(access_count, 0) + 1
   where purpose = 'quotation'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  update project_quotations set access_count = coalesce(access_count, 0) + 1
   where id = v_quote;
  return query
  select q.snapshot, q.notes, q.accepted_at, q.accepted_by_name, q.declined_at,
         cl.name, co.name,
         co.logo_url, co.phone, co.email, co.address, co.gstin,
         coalesce(q.shoots_schedule, '[]'::jsonb), q.terms_text,
         coalesce(q.display_prefs, '{}'::jsonb),
         coalesce(q.show_quotation, true), q.expires_at,
         (q.revoked_at is not null),
         coalesce(q.access_count, 0)
    from project_quotations q
    join projects p on p.id = q.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = q.company_id
   where q.id = v_quote
     and q.revoked_at is null
     and (q.expires_at is null or q.expires_at > now());
end;
$$;

revoke all on function get_quotation_for_token(text) from public;
grant execute on function get_quotation_for_token(text) to anon, authenticated;
