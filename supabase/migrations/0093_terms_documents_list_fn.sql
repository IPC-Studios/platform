-- GET /terms/documents read access_tokens directly through the authenticated
-- role to compute has_active_link, but access_tokens deliberately carries no
-- select policy for that role (0010: "never directly readable by clients,
-- only via SECURITY DEFINER fns") -- so the lateral join always found
-- nothing, and every studio's terms link showed "Link expired" the instant
-- it was issued, expired or not. Move the read behind a SECURITY DEFINER
-- function, the same pattern already used for issue_terms_document() and
-- get_terms_for_token() on this exact table.
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
   order by d.project_id, d.created_at desc
$$;
