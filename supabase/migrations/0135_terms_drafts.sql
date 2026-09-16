-- Terms you can stop writing and come back to.
--
-- The wizard had one exit: Issue. A studio part-way through composing a terms
-- sheet — template picked, payment split set, clauses half-edited — either
-- finished in one sitting or lost the lot. The old app has a Save draft
-- alongside Generate PDF, and that is the difference between a form and a
-- document you are actually working on.
--
-- A draft is the same row as a real document, minus the access token: nothing
-- has been sent, so there is nothing for a client to open. That keeps the
-- payment terms, sections and totals in the columns they will be issued from,
-- rather than in a parallel shape that has to be mapped across later.

alter table project_terms_documents
  add column if not exists is_draft boolean not null default false;

-- One per project. "Save draft" means "keep where I am", not "keep every
-- version of where I have been" — a second draft for the same project would
-- leave the studio choosing between two half-finished sheets.
create unique index if not exists project_terms_documents_one_draft_idx
  on project_terms_documents (company_id, project_id)
  where is_draft and project_id is not null;

-- The documents list takes ONE row per project (distinct on project_id,
-- newest first). A draft is newer than the issued document it was started
-- from, so without this filter saving a draft would hide the live document
-- and its link from the list — the acknowledgement state would appear to
-- vanish. Drafts have their own endpoint and are never part of this list.
create or replace function list_project_terms_documents()
returns table (
  id                  uuid,
  project_id          uuid,
  project_name        text,
  client_name         text,
  client_phone        text,
  acknowledged_at     timestamptz,
  acknowledged_by_name text,
  has_active_link     boolean,
  link_expires_at     timestamptz,
  created_at          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (d.project_id)
         d.id, d.project_id, p.name as project_name,
         cl.name as client_name, cl.phone as client_phone,
         d.acknowledged_at, d.acknowledged_by_name,
         (t.id is not null and t.used_at is null and (t.expires_at is null or t.expires_at > now())) as has_active_link,
         t.expires_at as link_expires_at,
         d.created_at
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join lateral (
      select id, expires_at, used_at from access_tokens
       where purpose = 'terms_ack' and subject_id = d.id
       order by created_at desc limit 1
    ) t on true
   where d.company_id = get_current_company_id()
     and not d.is_draft
   order by d.project_id, d.created_at desc
$$;

revoke all on function list_project_terms_documents() from public, anon;
grant execute on function list_project_terms_documents() to authenticated;
