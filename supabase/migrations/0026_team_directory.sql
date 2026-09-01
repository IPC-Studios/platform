-- Team directory, phase 2: engagement types, members without a login, and
-- invitations.
--
-- Three shifts to `users`:
--   * email becomes nullable — a freelancer added to the directory may only
--     ever be a phone number. `auth.users.email` is already nullable, so the
--     identity row can mirror that.
--   * login_enabled records the owner's choice at creation. It is descriptive,
--     not the gate: sign-in is refused by `encrypted_password is null` in
--     auth.users. Keeping the flag here means the directory can say "offline
--     member" without reaching across into the auth schema.
--   * alternate_phone — the second number studios actually keep for crew.
--
-- Invitations follow 0021/0022: only the SHA-256 hash is stored and the raw
-- token lives in the emailed link. Issuing and rotating happen through RLS (the
-- owner is signed in, and the API hashes the token before it touches the row);
-- only the two acceptance functions need SECURITY DEFINER, because the invitee
-- has no session yet.

alter table users
  alter column email drop not null;

alter table users
  add column if not exists alternate_phone text,
  add column if not exists login_enabled   boolean not null default true;

-- engagement_type existed unconstrained. Pin it to the two the UI offers;
-- null stays legal for rows predating the wizard (owners, legacy staff).
alter table users
  drop constraint if exists users_engagement_type_check;
alter table users
  add constraint users_engagement_type_check
  check (engagement_type is null or engagement_type in ('in_house', 'freelancer'));

-- ── user_invitations ──────────────────────────────────────────
-- pending_* carry what the owner filled in on the wizard; they become the
-- member's row at acceptance.
create table if not exists user_invitations (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies (id) on delete cascade,
  email                   text not null,
  token_hash              text not null unique,
  role                    app_role not null default 'employee',
  pending_name            text not null,
  pending_phone           text,
  pending_alternate_phone text,
  pending_engagement_type text,
  pending_salary          numeric(12, 2),
  pending_address         text,
  pending_role_ids        uuid[] not null default '{}',
  invited_by              uuid references auth.users (id),
  expires_at              timestamptz not null,
  accepted_at             timestamptz,
  accepted_by             uuid references auth.users (id),
  revoked_at              timestamptz,
  send_count              int not null default 1,
  last_sent_at            timestamptz not null default now(),
  created_at              timestamptz not null default now()
);
create index if not exists user_invitations_company_idx on user_invitations (company_id);

-- One live invite per address per studio. Re-inviting someone is a resend
-- (which rotates the token), never a second row racing the first.
create unique index if not exists user_invitations_live_idx
  on user_invitations (company_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table user_invitations enable row level security;

-- Owners see and manage their studio's invitations. Acceptance is unauthenticated
-- and goes through the SECURITY DEFINER functions below, not these policies.
create policy user_invitations_select_owner on user_invitations
  for select to authenticated
  using (company_id = get_current_company_id() and is_current_owner());

create policy user_invitations_write_owner on user_invitations
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());

-- ── peek (accept screen) ──────────────────────────────────────
-- What the invitee sees before committing: who invited them and to what. Never
-- exposes the pending salary — the link may sit in a shared inbox.
create or replace function peek_user_invitation(p_raw text)
returns table (email text, name text, company_name text, role app_role, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.email, i.pending_name, c.name, i.role, i.expires_at
  from user_invitations i
  join companies c on c.id = i.company_id
  where i.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
$$;

-- ── consume ───────────────────────────────────────────────────
-- One transaction: mint the identity, write the tenant row from pending_*,
-- apply job-role assignments, stamp the invitation. Returns the new user id,
-- or null when the token is dead. A duplicate email raises 23505 out of
-- auth.users and the API turns it into a 409 — the invitee already has an
-- account and should sign in instead.
--
-- Acceptance verifies the email: the invitee proved control of the mailbox by
-- following the link, and an unverified account cannot sign in.
create or replace function consume_user_invitation(p_raw text, p_password_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv  user_invitations%rowtype;
  v_user uuid;
  v_role uuid;
begin
  select * into v_inv
  from user_invitations
  where token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if v_inv.id is null then
    return null;
  end if;

  insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
  values (v_inv.email, p_password_hash, true, now())
  returning id into v_user;

  insert into users (
    user_id, company_id, role, name, email, phone, alternate_phone,
    status, employee_type, salary, address, engagement_type, login_enabled
  ) values (
    v_user, v_inv.company_id, v_inv.role, v_inv.pending_name, v_inv.email,
    v_inv.pending_phone, v_inv.pending_alternate_phone,
    'active',
    case when v_inv.role = 'employee' then 1 else 2 end,
    v_inv.pending_salary, v_inv.pending_address, v_inv.pending_engagement_type, true
  );

  foreach v_role in array v_inv.pending_role_ids loop
    insert into employee_role_assignments (user_id, role_id, company_id)
    values (v_user, v_role, v_inv.company_id)
    on conflict do nothing;
  end loop;

  update user_invitations
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  return v_user;
end;
$$;

revoke all on function peek_user_invitation(text)       from public, anon;
revoke all on function consume_user_invitation(text, text) from public, anon;
grant execute on function peek_user_invitation(text)          to service_role;
grant execute on function consume_user_invitation(text, text) to service_role;
