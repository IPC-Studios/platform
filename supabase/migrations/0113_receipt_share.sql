-- Lovable parity: receipt share (branding/GST/status/access/revoke/expiry).
-- Additive only: new columns + extended readers. Existing tokens keep working.

-- access_tokens: share controls (revoke + view counting). Idempotent.
alter table access_tokens add column if not exists revoked_at timestamptz;
alter table access_tokens add column if not exists access_count int not null default 0;

create or replace function revoke_access_token(p_purpose text, p_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update access_tokens
     set revoked_at = now()
   where purpose = p_purpose
     and subject_id = p_subject_id
     and company_id = get_current_company_id();
end;
$$;

create or replace function rotate_access_token(p_purpose text, p_subject_id uuid, p_ttl_hours int default 8760)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_raw text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update access_tokens
     set revoked_at = now()
   where purpose = p_purpose
     and subject_id = p_subject_id
     and company_id = get_current_company_id()
     and revoked_at is null;
  v_raw := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into access_tokens (company_id, purpose, subject_id, token_hash, expires_at)
    values (get_current_company_id(), p_purpose, p_subject_id,
            encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'),
            case when p_ttl_hours is null then null else now() + make_interval(hours => p_ttl_hours) end);
  return v_raw;
end;
$$;

-- Receipt email log (studio-side audit of send-receipt-email). Additive.
create table if not exists receipt_email_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  payment_id  uuid not null references received_payments (id) on delete cascade,
  to_email    text,
  status      text not null default 'sent',
  error       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table receipt_email_logs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'receipt_email_logs_select') then
    create policy receipt_email_logs_select on receipt_email_logs for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'receipt_email_logs_write') then
    create policy receipt_email_logs_write on receipt_email_logs for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- Extended public receipt reader: branding + GST + description + status +
-- access counting + revoke/expiry enforcement. Keeps old columns so existing
-- clients keep parsing; new columns are extra.
drop function if exists get_receipt_for_token(text);
create or replace function get_receipt_for_token(p_raw text)
returns table (
  amount numeric, paid_on date, mode text, reference text,
  project_name text, client_name text, company_name text,
  total_cost numeric, received_total numeric,
  logo_url text, gstin text, company_phone text, company_email text, company_address text,
  description text, status text, access_count int, revoked boolean, expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_payment uuid;
begin
  select subject_id into v_payment from access_tokens
   where purpose = 'receipt'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and (expires_at is null or expires_at > now())
     and revoked_at is null
   limit 1;
  if v_payment is null then
    return;
  end if;
  update access_tokens set access_count = coalesce(access_count, 0) + 1
   where purpose = 'receipt'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  return query
  select rp.amount, rp.paid_on, rp.mode, rp.reference,
         p.name, cl.name, co.name, p.total_cost,
         (select coalesce(sum(x.amount), 0) from received_payments x where x.project_id = p.id),
         co.logo_url, co.gstin, co.phone, co.email, co.address,
         rp.notes, coalesce(rp.status, 'received'),
         coalesce((select at2.access_count from access_tokens at2
            where at2.purpose = 'receipt'
              and at2.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
            limit 1), 0),
         false,
         (select at3.expires_at from access_tokens at3
            where at3.purpose = 'receipt'
              and at3.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
            limit 1)
    from received_payments rp
    join projects p on p.id = rp.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = rp.company_id
   where rp.id = v_payment;
end;
$$;

revoke all on function get_receipt_for_token(text) from public;
grant execute on function get_receipt_for_token(text) to anon, authenticated;
revoke all on function revoke_access_token(text, uuid) from public, anon;
grant execute on function revoke_access_token(text, uuid) to authenticated;
revoke all on function rotate_access_token(text, uuid, int) from public, anon;
grant execute on function rotate_access_token(text, uuid, int) to authenticated;
