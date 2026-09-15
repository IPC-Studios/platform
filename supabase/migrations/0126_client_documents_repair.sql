-- The client-facing documents were broken at runtime. Three of the five token
-- readers — quotation, receipt, delivery — threw on every call, so every studio
-- link a client opened returned an error.
--
-- Two independent faults, neither visible at migration time because PL/pgSQL
-- does not resolve a function body until it runs:
--
--   1. `expires_at` is declared as an OUT column in RETURNS TABLE and also
--      exists on access_tokens, so `where (expires_at is null or ...)` is
--      ambiguous and raises 42702. Fixed by aliasing the table and qualifying
--      every reference.
--   2. Each is declared `stable` while bumping an access counter, and Postgres
--      refuses "UPDATE is not allowed in a non-volatile function". So even with
--      the ambiguity fixed they would still have thrown.
--   3. The branding columns selected — co.logo_url, co.phone, co.email,
--      co.address, co.gstin — do not exist on `companies`. The real columns are
--      avatar_url / invoice_logo_url / invoice_phone / invoice_email /
--      invoice_address / invoice_gst_number.
--
-- The terms payload reader carried all three faults too.
--
-- The quotation reader also gains what the document actually needs to print as
-- a document rather than a price list: the studio's legal name, website and
-- footer note, the client's own contact block, a quotation number and issue
-- date, the real deliverables rows (with estimated dates and which ones carry
-- an extra charge), the second list, and the received/balance figures. The
-- contract and the page already expected deliverables_2, total_received,
-- balance_due and quotation_id — the function simply never returned them, so
-- those sections could not appear.

-- ── quotation ────────────────────────────────────────────────
drop function if exists get_quotation_for_token(text);
create or replace function get_quotation_for_token(p_raw text)
returns table (
  snapshot jsonb, notes text, accepted_at timestamptz, accepted_by_name text,
  declined_at timestamptz, client_name text, company_name text,
  logo_url text, company_phone text, company_email text, company_address text, gstin text,
  shoots_schedule jsonb, terms_text text, display_prefs jsonb,
  show_quotation boolean, expires_at timestamptz, revoked boolean, access_count int,
  -- document extras
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  project_name text, project_status text,
  quotation_number text, issued_at timestamptz, quotation_id uuid,
  deliverables jsonb, deliverables_2 jsonb,
  total_received numeric, balance_due numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_quote uuid;
begin
  select at.subject_id into v_quote from access_tokens at
   where at.purpose = 'quotation'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_quote is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'quotation' and at.token_hash = v_hash;
  update project_quotations q set access_count = coalesce(q.access_count, 0) + 1
   where q.id = v_quote;

  return query
  select q.snapshot, q.notes, q.accepted_at, q.accepted_by_name, q.declined_at,
         cl.name, coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address, co.invoice_gst_number,
         coalesce(q.shoots_schedule, '[]'::jsonb), q.terms_text,
         coalesce(q.display_prefs, '{}'::jsonb),
         coalesce(q.show_quotation, true), q.expires_at,
         (q.revoked_at is not null),
         coalesce(q.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         p.name, p.status,
         -- Human-readable and stable: the studio's prefix plus the quote's own id.
         coalesce(co.quote_number_prefix, 'Q-') || upper(substring(q.id::text, 1, 8)),
         q.created_at, q.id,
         -- The real rows, so the document can show estimated dates and which
         -- items carry an extra charge rather than a flat "Included".
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title, 'description', d.description,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key = 'primary'
              and coalesce(d.show_on_quotation, true)), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title, 'description', d.description,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key <> 'primary'
              and coalesce(d.show_on_quotation, true)), '[]'::jsonb),
         coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id), 0),
         greatest(coalesce(p.total_cost, 0)
                  - coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id), 0), 0)
    from project_quotations q
    join projects p on p.id = q.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = q.company_id
   where q.id = v_quote
     and q.revoked_at is null
     and (q.expires_at is null or q.expires_at > now());
end;
$$;
revoke all on function get_quotation_for_token(text) from public;
grant execute on function get_quotation_for_token(text) to anon, authenticated;

-- ── receipt ──────────────────────────────────────────────────
drop function if exists get_receipt_for_token(text);
create or replace function get_receipt_for_token(p_raw text)
returns table (
  amount numeric, paid_on date, mode text, reference text,
  project_name text, client_name text, company_name text,
  total_cost numeric, received_total numeric,
  logo_url text, gstin text, company_phone text, company_email text, company_address text,
  description text, status text, access_count int, revoked boolean, expires_at timestamptz,
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  receipt_number text, is_gst boolean, payment_gst_number text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_payment uuid;
  v_expires timestamptz;
  v_count int;
begin
  select at.subject_id, at.expires_at, coalesce(at.access_count, 0)
    into v_payment, v_expires, v_count
    from access_tokens at
   where at.purpose = 'receipt'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_payment is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'receipt' and at.token_hash = v_hash;

  return query
  select rp.amount, coalesce(rp.date_received, rp.paid_on), rp.mode, rp.reference,
         p.name, cl.name, coalesce(co.display_name, co.name), p.total_cost,
         (select coalesce(sum(x.amount), 0) from received_payments x where x.project_id = p.id),
         coalesce(co.invoice_logo_url, co.avatar_url), co.invoice_gst_number,
         co.invoice_phone, co.invoice_email, co.invoice_address,
         coalesce(rp.description, rp.notes), coalesce(rp.status, 'paid'),
         v_count + 1, false, v_expires,
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         'R-' || upper(substring(rp.id::text, 1, 8)),
         coalesce(rp.is_gst, false), rp.gst_number
    from received_payments rp
    join projects p on p.id = rp.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = rp.company_id
   where rp.id = v_payment;
end;
$$;
revoke all on function get_receipt_for_token(text) from public;
grant execute on function get_receipt_for_token(text) to anon, authenticated;

-- ── delivery ─────────────────────────────────────────────────
drop function if exists get_delivery_for_token(text);
create or replace function get_delivery_for_token(p_raw text)
returns table (
  submission_link text, notes text, delivered_at timestamptz,
  project_name text, client_name text, company_name text,
  title text, delivery_type text, delivery_label text, logo_url text,
  ready_at timestamptz, revoked boolean, expires_at timestamptz, access_count int,
  company_legal_name text, company_website text, document_footer_note text,
  company_phone text, company_email text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_sub uuid;
  v_expires timestamptz;
begin
  select at.subject_id, at.expires_at into v_sub, v_expires
    from access_tokens at
   where at.purpose = 'work_delivery'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_sub is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'work_delivery' and at.token_hash = v_hash;
  update team_work_submissions s set access_count = coalesce(s.access_count, 0) + 1
   where s.id = v_sub;

  return query
  select s.submission_link, s.notes,
         (select max(d.delivered_at) from team_work_client_deliveries d
           where d.submission_id = s.id and d.revoked_at is null),
         p.name, cl.name, coalesce(co.display_name, co.name),
         s.title, s.delivery_type, s.delivery_label,
         coalesce(co.invoice_logo_url, co.avatar_url),
         s.ready_at, (s.revoked_at is not null), v_expires,
         coalesce(s.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         co.invoice_phone, co.invoice_email
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

-- ── terms (rich payload) ─────────────────────────────────────
-- Same three faults, plus the client's own contact block and the studio's
-- legal name / website / footer note, which the terms sheet is a legal
-- document without.
drop function if exists get_terms_payload_for_token(text);
create or replace function get_terms_payload_for_token(p_raw text)
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
         'T-' || upper(substring(d.id::text, 1, 8)), d.created_at
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
