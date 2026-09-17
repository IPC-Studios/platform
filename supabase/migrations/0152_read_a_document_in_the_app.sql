-- The studio could not read its own terms document without pretending to be
-- the client.
--
-- Everything that renders a terms sheet goes through
-- get_terms_payload_for_token(), which resolves an access_tokens row. So the
-- only way to see what was actually sent was to mint or copy a client link and
-- open it — on a page built for the client, with an "I agree" box on it.
--
-- That has two costs. The obvious one: there is no way to check a document
-- before or after sending it. The quiet one is worse — that function is
-- `volatile` because it BUMPS COUNTERS:
--
--     update access_tokens ... set access_count = access_count + 1
--     update project_terms_documents ... set access_count = access_count + 1
--
-- which the Documents page reports as client engagement. Every internal check
-- inflated "the client has opened this N times", so the one number telling a
-- studio whether the client had actually read the terms was counting the
-- studio's own visits.
--
-- This is the same payload, addressed by document id, scoped to the caller's
-- company, and counting nothing. It is `stable` rather than `volatile`, which
-- is the whole point: looking is not an event.
--
-- It also deliberately does NOT filter on revoked_at or expires_at. A revoked
-- or lapsed document is exactly the one a studio needs to re-read — "what did
-- we send them in March" does not stop mattering because the link expired. The
-- payload reports both states so the viewer can say so on the page.

create or replace function get_terms_payload_for_document(p_doc uuid)
returns table (
  title text, body text, project_name text, client_name text, client_phone text,
  company_name text, logo_url text, company_phone text, company_email text, company_address text,
  payment_summary text, sections jsonb, expires_at timestamptz, revoked boolean,
  acknowledged_at timestamptz, acknowledged_by_name text, access_count int,
  company_legal_name text, company_website text, document_footer_note text,
  client_email text, client_address text, gstin text,
  document_number text, issued_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select d.title, d.rendered_body, p.name, cl.name, cl.phone,
         coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address,
         d.payment_summary, coalesce(d.sections, '[]'::jsonb), d.expires_at,
         (d.revoked_at is not null),
         d.acknowledged_at, d.acknowledged_by_name, coalesce(d.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.email, cl.address, co.invoice_gst_number,
         'T-' || upper(substring(d.id::text, 1, 8)), d.created_at
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = d.company_id
   -- The tenancy check that the token version gets from the token itself.
   where d.id = p_doc
     and d.company_id = v_company;
end;
$$;

revoke all on function get_terms_payload_for_document(uuid) from public, anon;
grant execute on function get_terms_payload_for_document(uuid) to authenticated;
