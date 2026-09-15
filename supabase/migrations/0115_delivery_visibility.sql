-- Lovable parity: delivery visibility (sent + submitted&&!reviewed), TTL 365d, revoke, access count.
-- Additive only.

alter table team_work_submissions add column if not exists title text;
alter table team_work_submissions add column if not exists delivery_type text;
alter table team_work_submissions add column if not exists delivery_label text;
alter table team_work_submissions add column if not exists branding_snapshot jsonb;
alter table team_work_submissions add column if not exists ready_at timestamptz;
alter table team_work_submissions add column if not exists revoked_at timestamptz;
alter table team_work_submissions add column if not exists access_count int not null default 0;
alter table team_work_client_deliveries add column if not exists expires_at timestamptz;
alter table team_work_client_deliveries add column if not exists revoked_at timestamptz;

-- Deliver from submitted OR approved (not just approved). Rejected stays hidden.
-- TTL configurable via p_ttl_hours; Lovable default 365d (8760h).
create or replace function deliver_work_to_client(
  p_submission_id uuid,
  p_channel       text default 'email',
  p_ttl_hours     int default 8760
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_token text;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from team_work_submissions
    where id = p_submission_id
      and company_id = get_current_company_id()
      and status in ('submitted', 'approved', 'sent')
  ) then
    raise exception 'submission must be submitted or approved before delivery';
  end if;

  insert into team_work_client_deliveries (company_id, submission_id, channel,
    expires_at)
    values (get_current_company_id(), p_submission_id, p_channel,
            case when p_ttl_hours is null then null else now() + make_interval(hours => p_ttl_hours) end);
  update team_work_submissions
     set ready_at = coalesce(ready_at, now()),
         status = case when status = 'submitted' then 'sent' else status end
   where id = p_submission_id;
  v_token := issue_access_token('work_delivery', p_submission_id, p_ttl_hours);
  return v_token;
end;
$$;

drop function if exists get_delivery_for_token(text);
create or replace function get_delivery_for_token(p_raw text)
returns table (
  submission_link text, notes text, delivered_at timestamptz,
  project_name text, client_name text, company_name text,
  title text, delivery_type text, delivery_label text, logo_url text,
  ready_at timestamptz, revoked boolean, expires_at timestamptz, access_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_sub uuid;
begin
  select subject_id into v_sub from access_tokens
   where purpose = 'work_delivery'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and (expires_at is null or expires_at > now())
     and revoked_at is null
   limit 1;
  if v_sub is null then
    return;
  end if;
  update access_tokens set access_count = coalesce(access_count, 0) + 1
   where purpose = 'work_delivery'
     and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  update team_work_submissions set access_count = coalesce(access_count, 0) + 1
   where id = v_sub;
  return query
  select s.submission_link, s.notes,
         (select max(d.delivered_at) from team_work_client_deliveries d
           where d.submission_id = s.id and d.revoked_at is null),
         p.name, cl.name, co.name,
         s.title, s.delivery_type, s.delivery_label, co.logo_url,
         s.ready_at, (s.revoked_at is not null),
         (select at2.expires_at from access_tokens at2
            where at2.purpose = 'work_delivery'
              and at2.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
            limit 1),
         coalesce(s.access_count, 0)
    from team_work_submissions s
    left join projects p on p.id = s.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = s.company_id
   where s.id = v_sub
     and s.status in ('submitted', 'approved', 'sent')
     and s.revoked_at is null;
end;
$$;

revoke all on function get_delivery_for_token(text) from public;
grant execute on function get_delivery_for_token(text) to anon, authenticated;
