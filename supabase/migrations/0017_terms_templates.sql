-- Phase 15: terms, quotations, templates. Acknowledgement runs on the shared
-- access_tokens helper (Phase 8). A client opens a public link, taps "I agree",
-- and their name/time/IP/user-agent is recorded as evidence.

create table project_terms_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  body       text not null,   -- may contain {{variables}}
  version    int not null default 1,
  created_at timestamptz not null default now()
);

create table project_terms_documents (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references companies (id) on delete cascade,
  project_id                uuid references projects (id) on delete cascade,
  template_id               uuid references project_terms_templates (id) on delete set null,
  rendered_body             text not null,   -- variables already substituted
  acknowledged_at           timestamptz,
  acknowledged_by_name      text,
  acknowledged_by_email     text,
  acknowledged_ip           text,
  acknowledged_user_agent   text,
  created_at                timestamptz not null default now()
);
create index ptd_company_project_idx on project_terms_documents (company_id, project_id);

-- Reusable deliverable bundles (used by the create-project wizard later).
create table deliverable_presets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  items      jsonb not null default '[]'::jsonb,
  usage_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table project_terms_templates enable row level security;
alter table project_terms_documents enable row level security;
alter table deliverable_presets     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['project_terms_templates','project_terms_documents','deliverable_presets']
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = get_current_company_id() and is_current_user_active())
         with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
  end loop;
end $$;

-- ── Issue a terms document + client acknowledgement link ──────
create or replace function issue_terms_document(
  p_project_id    uuid,
  p_rendered_body text,
  p_template_id   uuid default null,
  p_ttl_hours     int default 336
)
returns table (document_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_doc     uuid;
  v_token   text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into project_terms_documents (company_id, project_id, template_id, rendered_body)
    values (v_company, p_project_id, p_template_id, p_rendered_body)
    returning id into v_doc;
  v_token := issue_access_token('terms_ack', v_doc, p_ttl_hours);
  return query select v_doc, v_token;
end;
$$;

-- Public: fetch the terms body for a valid token (for display).
create or replace function get_terms_for_token(p_raw text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.rendered_body
  from project_terms_documents d
  where d.id = resolve_access_token('terms_ack', p_raw)
$$;

-- Public: record acknowledgement (one-time consume + evidence).
create or replace function acknowledge_terms(
  p_raw        text,
  p_name       text,
  p_email      text default null,
  p_ip         text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_doc uuid;
begin
  v_doc := consume_access_token('terms_ack', p_raw);
  if v_doc is null then
    return false;   -- invalid, expired, or already acknowledged
  end if;
  update project_terms_documents
    set acknowledged_at = now(), acknowledged_by_name = p_name,
        acknowledged_by_email = p_email, acknowledged_ip = p_ip,
        acknowledged_user_agent = p_user_agent
    where id = v_doc;
  return true;
end;
$$;

revoke all on function issue_terms_document(uuid, text, uuid, int) from public, anon;
revoke all on function get_terms_for_token(text)                   from public;
revoke all on function acknowledge_terms(text, text, text, text, text) from public;
grant execute on function issue_terms_document(uuid, text, uuid, int) to authenticated;
grant execute on function get_terms_for_token(text)                   to anon, authenticated;
grant execute on function acknowledge_terms(text, text, text, text, text) to anon, authenticated;
