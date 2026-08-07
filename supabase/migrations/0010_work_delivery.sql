-- Phase 8: work submission -> review -> tokenised client delivery.
-- Built once here: a GENERIC tokenised-link helper (access_tokens) reused by
-- quotation/terms acknowledgement and payment receipts in later phases.

-- ── Generic tokenised-link helper ─────────────────────────────
create table access_tokens (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  purpose    text not null,   -- work_delivery | quotation_ack | terms_ack | payment_receipt | ...
  subject_id uuid not null,   -- the entity the token grants access to
  token_hash text not null unique,
  expires_at timestamptz,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index access_tokens_purpose_subject_idx on access_tokens (purpose, subject_id);

-- Issue a token; returns the RAW value once (only its hash is stored).
create or replace function issue_access_token(
  p_purpose    text,
  p_subject_id uuid,
  p_ttl_hours  int default 168
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into access_tokens (company_id, purpose, subject_id, token_hash, expires_at)
    values (get_current_company_id(), p_purpose, p_subject_id,
            encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'),
            case when p_ttl_hours is null then null else now() + make_interval(hours => p_ttl_hours) end);
  return v_raw;
end;
$$;

-- Resolve a raw token (public / anon). Returns the subject_id if valid + unexpired.
create or replace function resolve_access_token(p_purpose text, p_raw text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select subject_id from access_tokens
  where purpose = p_purpose
    and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
    and (expires_at is null or expires_at > now())
  limit 1
$$;

-- Consume a one-time token (acknowledgements). Marks used; false if already used/invalid.
create or replace function consume_access_token(p_purpose text, p_raw text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject uuid;
begin
  update access_tokens set used_at = now()
    where purpose = p_purpose
      and token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
      and used_at is null
      and (expires_at is null or expires_at > now())
    returning subject_id into v_subject;
  return v_subject;
end;
$$;

-- ── Work submission + delivery ────────────────────────────────
create table team_work_submissions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  task_id        uuid references tasks (id) on delete set null,
  project_id     uuid references projects (id) on delete cascade,
  submitted_by   uuid references auth.users (id),
  submission_link text,
  location_note  text,
  notes          text,
  status         text not null default 'submitted'
                   check (status in ('submitted', 'approved', 'rejected')),
  review_notes   text,
  reviewed_by    uuid references auth.users (id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index tws_company_status_idx on team_work_submissions (company_id, status);
create trigger tws_set_updated_at before update on team_work_submissions
  for each row execute function set_updated_at();

create table team_work_client_deliveries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  submission_id uuid not null references team_work_submissions (id) on delete cascade,
  channel       text,
  delivered_at  timestamptz not null default now(),
  notes         text
);

alter table access_tokens                enable row level security;
alter table team_work_submissions        enable row level security;
alter table team_work_client_deliveries  enable row level security;

-- access_tokens: never directly readable by clients (only via SECURITY DEFINER fns).
-- No select policy → authenticated sees nothing; service_role/definer bypass.

create policy tws_select on team_work_submissions
  for select to authenticated
  using (
    company_id = get_current_company_id()
    and (is_current_admin_or_manager() or submitted_by = auth.uid())
  );
create policy twcd_select on team_work_client_deliveries
  for select to authenticated
  using (company_id = get_current_company_id());

-- ── RPCs ──────────────────────────────────────────────────────
create or replace function submit_work(
  p_task_id    uuid,
  p_project_id uuid,
  p_link       text,
  p_notes      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into team_work_submissions (company_id, task_id, project_id, submitted_by, submission_link, notes)
    values (get_current_company_id(), p_task_id, p_project_id, auth.uid(), p_link, p_notes)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function review_work(
  p_submission_id uuid,
  p_approve       boolean,
  p_review_notes  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update team_work_submissions
    set status = case when p_approve then 'approved' else 'rejected' end,
        review_notes = p_review_notes, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_submission_id and company_id = get_current_company_id();
end;
$$;

-- Approve-gated delivery: records the delivery and issues a client link token.
create or replace function deliver_work_to_client(
  p_submission_id uuid,
  p_channel       text default 'email',
  p_ttl_hours     int default 168
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
    where id = p_submission_id and company_id = get_current_company_id() and status = 'approved'
  ) then
    raise exception 'submission must be approved before delivery';
  end if;

  insert into team_work_client_deliveries (company_id, submission_id, channel)
    values (get_current_company_id(), p_submission_id, p_channel);
  v_token := issue_access_token('work_delivery', p_submission_id, p_ttl_hours);
  return v_token;
end;
$$;

revoke all on function issue_access_token(text, uuid, int)   from public, anon;
revoke all on function consume_access_token(text, text)      from public, anon;
revoke all on function submit_work(uuid, uuid, text, text)   from public, anon;
revoke all on function review_work(uuid, boolean, text)      from public, anon;
revoke all on function deliver_work_to_client(uuid, text, int) from public, anon;
grant execute on function issue_access_token(text, uuid, int)   to authenticated;
grant execute on function consume_access_token(text, text)      to authenticated, anon;
grant execute on function resolve_access_token(text, text)      to authenticated, anon;
grant execute on function submit_work(uuid, uuid, text, text)   to authenticated;
grant execute on function review_work(uuid, boolean, text)      to authenticated;
grant execute on function deliver_work_to_client(uuid, text, int) to authenticated;
