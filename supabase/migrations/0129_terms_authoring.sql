-- Terms authoring: the payload the client page already expects, plus a
-- template library to start from.
--
-- The public terms page has always read `payment_terms`, `total_cost` and
-- `legal_note` — they are in its schema and it renders a payment table from
-- them. Nothing ever stored or returned them, so that table could not appear.
-- Same shape of fault as the quotation's deliverables lists.
--
-- Payment terms are stored as jsonb rather than rows: they are a frozen
-- snapshot of what the client agreed to, exactly like the quotation's, and
-- must not drift when the project's schedule is edited afterwards.

alter table project_terms_documents
  add column if not exists payment_terms jsonb not null default '[]'::jsonb,
  add column if not exists total_cost numeric(12, 2),
  add column if not exists legal_note text;

-- ── template library ─────────────────────────────────────────
-- The old app opens the wizard with a template picker and a Seed button. The
-- table has existed since 0017 with no way to fill it.
create or replace function seed_terms_templates()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_n int := 0;
begin
  if v_company is null then
    raise exception 'no company in context' using errcode = '42501';
  end if;

  insert into project_terms_templates (company_id, name, body)
  select v_company, t.name, t.body
    from (values
      ('Standard wedding',
       E'1. A signing amount confirms the date. Dates are held only once it is received.\n'
       '2. The balance is payable as set out in the payment schedule above.\n'
       '3. Travel and stay outside the quoted city are billed at actual cost.\n'
       '4. Edited photographs are delivered within the agreed timeline from the final event date.\n'
       '5. Raw footage is retained for 90 days and shared only on request.\n'
       '6. We may use selected images for our portfolio unless you tell us otherwise in writing.'),
      ('Commercial shoot',
       E'1. Usage rights are limited to the channels named in the brief.\n'
       '2. Additional usage is quoted separately before publication.\n'
       '3. Shoot days run to the hours agreed; overtime is billed per hour.\n'
       '4. Delivery is in the formats listed in the quotation.\n'
       '5. One round of revisions is included; further rounds are chargeable.'),
      ('Event coverage',
       E'1. Coverage runs for the hours stated in the schedule.\n'
       '2. Access, permissions and venue clearances are arranged by the client.\n'
       '3. A meal break is required for crew on shifts beyond six hours.\n'
       '4. Delivery timelines run from the final event date.')
    ) as t(name, body)
   where not exists (
     select 1 from project_terms_templates x
      where x.company_id = v_company and x.name = t.name);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function seed_terms_templates() from public, anon;
grant execute on function seed_terms_templates() to authenticated;

-- ── return the new fields to the client page ─────────────────
drop function if exists get_terms_payload_for_token(text);
create or replace function get_terms_payload_for_token(p_raw text)
returns table (
  title text, body text, project_name text, client_name text, client_phone text,
  company_name text, logo_url text, company_phone text, company_email text, company_address text,
  payment_summary text, sections jsonb, expires_at timestamptz, revoked boolean,
  acknowledged_at timestamptz, acknowledged_by_name text, access_count int,
  company_legal_name text, company_website text, document_footer_note text,
  client_email text, client_address text, gstin text,
  document_number text, issued_at timestamptz,
  payment_terms jsonb, total_cost numeric, legal_note text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_doc uuid;
begin
  select at.subject_id into v_doc from access_tokens at
   where at.purpose = 'terms_ack'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_doc is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'terms_ack' and at.token_hash = v_hash;
  update project_terms_documents d set access_count = coalesce(d.access_count, 0) + 1
   where d.id = v_doc;

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
         'T-' || upper(substring(d.id::text, 1, 8)), d.created_at,
         coalesce(d.payment_terms, '[]'::jsonb),
         coalesce(d.total_cost, p.total_cost),
         d.legal_note
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = d.company_id
   where d.id = v_doc
     and d.revoked_at is null
     and (d.expires_at is null or d.expires_at > now());
end;
$$;
revoke all on function get_terms_payload_for_token(text) from public;
grant execute on function get_terms_payload_for_token(text) to anon, authenticated;
