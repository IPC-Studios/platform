-- Team terms: the agreement a studio puts in front of its crew.
--
-- 0017 built the client-facing half of this — a template, a rendered document,
-- a tokenised link, an acknowledgement with evidence. This is the same shape
-- pointed the other way: at the photographer booked for Saturday rather than
-- the couple paying for it. The token, the public reader and the evidence
-- trail are the ones already built in 0010; only the subject changes.

-- ── templates ─────────────────────────────────────────────────
create table if not exists team_terms_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  title         text not null,
  description   text,
  -- May contain {{variables}}; they are substituted when a send is created,
  -- never on the way in — a template is a template until it is sent.
  body          text not null,
  -- 'send_only' is a briefing nobody signs; 'acknowledgement_required' expects
  -- the crew member to press the button and put their name to it.
  mode          text not null default 'acknowledgement_required'
                  check (mode in ('send_only', 'acknowledgement_required')),
  -- How long the link stays open. Null = no expiry.
  validity_days int check (validity_days is null or validity_days between 1 and 365),
  category      text check (category is null or category in (
                  'pre_production', 'production', 'post_production',
                  'general', 'business_protection')),
  -- Bumped on every edit. A send keeps the number it went out under, so
  -- "which words did they actually agree to" survives the next revision.
  version       int not null default 1,
  is_active     boolean not null default true,
  archived_at   timestamptz,
  created_by    uuid references users (user_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ttt_company_idx on team_terms_templates (company_id, category, title);
drop trigger if exists team_terms_templates_set_updated_at on team_terms_templates;
create trigger team_terms_templates_set_updated_at before update on team_terms_templates
  for each row execute function set_updated_at();

-- Which job roles a template covers. `is_default` is the one offered first
-- when a Drone Operator is booked and somebody presses Send.
create table if not exists team_terms_template_roles (
  template_id uuid not null references team_terms_templates (id) on delete cascade,
  role_id     uuid not null references employee_roles (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  is_default  boolean not null default false,
  primary key (template_id, role_id)
);
create index if not exists tttr_role_idx on team_terms_template_roles (role_id);

-- ── sends ─────────────────────────────────────────────────────
-- One row per "these terms went to this person for this shoot".
create table if not exists team_terms_sends (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies (id) on delete cascade,
  shoot_id         uuid references shoots (id) on delete cascade,
  project_id       uuid references projects (id) on delete set null,
  -- Null for a freelancer who has no login; the recipient fields carry them.
  user_id          uuid references users (user_id) on delete set null,
  role_id          uuid references employee_roles (id) on delete set null,
  role_name        text,
  template_id      uuid references team_terms_templates (id) on delete set null,
  template_version int,
  mode             text not null default 'acknowledgement_required'
                     check (mode in ('send_only', 'acknowledgement_required')),
  -- The words as they went out, variables already substituted. Kept on the row
  -- rather than re-rendered from the template: what someone agreed to must not
  -- change because the template was edited afterwards.
  rendered_body    text not null,
  recipient_name   text not null,
  recipient_email  text,
  recipient_phone  text,
  status           text not null default 'draft'
                     check (status in ('draft', 'sent', 'viewed', 'acknowledged',
                                       'expired', 'revoked')),
  sent_via         text,
  sent_at          timestamptz,
  viewed_at        timestamptz,
  acknowledged_at  timestamptz,
  acknowledged_by_name text,
  acknowledged_ip      text,
  acknowledged_user_agent text,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tts_shoot_idx on team_terms_sends (company_id, shoot_id);
create index if not exists tts_user_idx on team_terms_sends (company_id, user_id);
drop trigger if exists team_terms_sends_set_updated_at on team_terms_sends;
create trigger team_terms_sends_set_updated_at before update on team_terms_sends
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
alter table team_terms_templates      enable row level security;
alter table team_terms_template_roles enable row level security;
alter table team_terms_sends          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['team_terms_templates', 'team_terms_template_roles', 'team_terms_sends']
  loop
    execute format('drop policy if exists %I_select on %I;', t, t);
    execute format('drop policy if exists %I_write on %I;', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = get_current_company_id() and is_current_user_active())
         with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
  end loop;
end $$;

-- ── issuing and acknowledging ─────────────────────────────────
-- Create the send and its link in one step, so a row can never exist with no
-- way to open it (or a token with nothing behind it).
create or replace function issue_team_terms(
  p_shoot_id        uuid,
  p_template_id     uuid,
  p_rendered_body   text,
  p_recipient_name  text,
  p_recipient_email text default null,
  p_recipient_phone text default null,
  p_user_id         uuid default null,
  p_role_id         uuid default null,
  p_role_name       text default null,
  p_ttl_hours       int  default 336
)
returns table (send_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_send     uuid;
  v_token    text;
  v_expires  timestamptz := case when p_ttl_hours is null
                                 then null
                                 else now() + make_interval(hours => p_ttl_hours) end;
  v_template team_terms_templates;
  v_project  uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the ids are scoped by hand: a template
  -- id alone must not reach across studios.
  select * into v_template from team_terms_templates
   where id = p_template_id and company_id = v_company;
  if v_template.id is null then
    raise exception 'template not found' using errcode = 'P0001';
  end if;

  select project_id into v_project from shoots
   where id = p_shoot_id and company_id = v_company;
  if v_project is null and p_shoot_id is not null then
    raise exception 'shoot not found' using errcode = 'P0001';
  end if;

  insert into team_terms_sends (
    company_id, shoot_id, project_id, user_id, role_id, role_name,
    template_id, template_version, mode, rendered_body,
    recipient_name, recipient_email, recipient_phone, status, expires_at
  ) values (
    v_company, p_shoot_id, v_project, p_user_id, p_role_id, p_role_name,
    v_template.id, v_template.version, v_template.mode, p_rendered_body,
    p_recipient_name, p_recipient_email, p_recipient_phone, 'draft', v_expires
  )
  returning id into v_send;

  v_token := issue_access_token('team_terms', v_send, p_ttl_hours);
  return query select v_send, v_token, v_expires;
end;
$$;

-- Public: the terms behind a link, and a record that they were opened.
-- Reading marks it viewed, which is the only signal a send-only template ever
-- produces — there is no button to press on one.
create or replace function get_team_terms_for_token(p_raw text)
returns table (
  send_id uuid, status text, mode text, recipient_name text, role_name text,
  rendered_body text, acknowledged_at timestamptz, acknowledged_by_name text,
  expires_at timestamptz, shoot_name text, shoot_date date, project_name text,
  company_name text
)
language plpgsql
security definer
set search_path = public
as $$
-- The OUT parameters share names with the columns below (status, mode…).
-- Column wins: the OUT values are only ever set by the RETURN QUERY.
#variable_conflict use_column
declare v_send uuid := resolve_access_token('team_terms', p_raw);
begin
  if v_send is null then
    return;
  end if;
  update team_terms_sends
     set viewed_at = coalesce(viewed_at, now()),
         status = case when status in ('sent', 'draft') then 'viewed' else status end
   where id = v_send and revoked_at is null;

  return query
    select s.id, s.status, s.mode, s.recipient_name, s.role_name,
           s.rendered_body, s.acknowledged_at, s.acknowledged_by_name,
           s.expires_at, sh.name, sh.shoot_date, p.name, c.name
      from team_terms_sends s
      left join shoots sh on sh.id = s.shoot_id
      left join projects p on p.id = s.project_id
      left join companies c on c.id = s.company_id
     where s.id = v_send and s.revoked_at is null;
end;
$$;

create or replace function acknowledge_team_terms(
  p_raw        text,
  p_name       text,
  p_ip         text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_send uuid;
begin
  -- Consume rather than resolve: an acknowledgement happens once, and the
  -- token dies with it.
  v_send := consume_access_token('team_terms', p_raw);
  if v_send is null then
    return false;
  end if;
  update team_terms_sends
     set status = 'acknowledged', acknowledged_at = now(),
         acknowledged_by_name = p_name, acknowledged_ip = p_ip,
         acknowledged_user_agent = p_user_agent
   where id = v_send and revoked_at is null and mode = 'acknowledgement_required';
  return found;
end;
$$;

revoke all on function issue_team_terms(uuid, uuid, text, text, text, text, uuid, uuid, text, int) from public, anon;
revoke all on function get_team_terms_for_token(text)                    from public;
revoke all on function acknowledge_team_terms(text, text, text, text)    from public;
grant execute on function issue_team_terms(uuid, uuid, text, text, text, text, uuid, uuid, text, int) to authenticated;
grant execute on function get_team_terms_for_token(text)                 to anon, authenticated;
grant execute on function acknowledge_team_terms(text, text, text, text) to anon, authenticated;

-- ── housekeeping ──────────────────────────────────────────────
-- 0017 created deliverable_presets and nothing ever read or wrote it; 0039
-- built deliverable_sets for that job and shipped. Two tables for one idea is
-- how the next person loses an afternoon, so the unused one goes.
drop table if exists deliverable_presets;
