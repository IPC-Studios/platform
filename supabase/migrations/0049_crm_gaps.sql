-- 0049: the gaps a walk through the CRM turned up.
--
-- Three things the product could not do that the schema already supported:
-- record a quote answered off the link, show the client which state a quote
-- was priced for, and read back what a workflow actually did.

-- ══════════════════════════════════════════════════════════════
-- 1. A quote answered away from the link
-- ══════════════════════════════════════════════════════════════
-- accept_quote() and decline_quote() are the client's path, reached with a
-- token. Most Indian studios are told "yes" on the phone, and there was no
-- way to record that: the quote stayed 'sent' for ever, the accepted-value
-- tile under-reported, and convert-from-quote never defaulted. This is the
-- same transition made by a person who is signed in, with their name on it.
create or replace function crm_set_quote_outcome(
  p_quote  uuid,
  p_status text,
  p_name   text default null,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_q       crm_quotes;
  v_who     text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'declined', 'sent') then
    raise exception 'unknown quote status' using errcode = '22023';
  end if;
  select * into v_q from crm_quotes where id = p_quote and company_id = v_company;
  if not found then
    raise exception 'unknown quote' using errcode = '42501';
  end if;
  if v_q.status = 'draft' then
    raise exception 'Send the quote before recording an answer.' using errcode = 'P0001';
  end if;
  if v_q.status = p_status then
    return v_q.status;
  end if;

  select u.name into v_who from users u where u.user_id = auth.uid();
  v_who := coalesce(nullif(trim(coalesce(p_name, '')), ''), v_who, 'the studio');

  if p_status = 'accepted' then
    update crm_quotes
       set status = 'accepted', accepted_at = now(), accepted_by_name = v_who,
           accepted_by_email = null, accepted_ip = null, accepted_user_agent = null,
           declined_at = null, decline_reason = null
     where id = p_quote;
    update crm_leads set deal_value = v_q.total where id = v_q.lead_id;
  elsif p_status = 'declined' then
    update crm_quotes
       set status = 'declined', declined_at = now(), decline_reason = left(p_reason, 500),
           accepted_at = null, accepted_by_name = null
     where id = p_quote;
  else
    -- Reopening a quote answered by mistake.
    update crm_quotes
       set status = 'sent', accepted_at = null, accepted_by_name = null, accepted_by_email = null,
           accepted_ip = null, accepted_user_agent = null, declined_at = null, decline_reason = null
     where id = p_quote;
  end if;

  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, v_q.lead_id, null, null, auth.uid(),
          'quote ' || v_q.quote_number || ' marked ' || p_status || ' by ' || v_who
          || case when p_status = 'declined' and p_reason is not null then ': ' || left(p_reason, 200) else '' end);
  return p_status;
end;
$$;
revoke all on function crm_set_quote_outcome(uuid, text, text, text) from public, anon;
grant execute on function crm_set_quote_outcome(uuid, text, text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. The client sees which state the tax was worked out for
-- ══════════════════════════════════════════════════════════════
-- The quote shows a CGST/SGST or IGST split; without the place of supply
-- beside it, the client cannot check the split is the right one.
create or replace function get_quote_for_token(p_raw text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := resolve_access_token('quote_accept', p_raw);
  v_q crm_quotes;
  r jsonb;
begin
  if v_id is null then
    -- A consumed token still shows the quote, read-only, so the client can
    -- come back to what they agreed to.
    select id into v_id from crm_quotes q
     where exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                     and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex'));
    if v_id is null then return null; end if;
  end if;
  select * into v_q from crm_quotes where id = v_id;
  select jsonb_build_object(
    'quote_number', v_q.quote_number, 'title', v_q.title, 'status', v_q.status, 'valid_until', v_q.valid_until,
    'subtotal', v_q.subtotal, 'discount', v_q.discount, 'taxable', v_q.taxable, 'tax', v_q.tax, 'total', v_q.total,
    'notes', v_q.notes, 'terms', v_q.terms, 'accepted_at', v_q.accepted_at, 'declined_at', v_q.declined_at,
    'place_of_supply', v_q.place_of_supply, 'intra_state', v_q.intra_state,
    'studio', (select c.name from companies c where c.id = v_q.company_id),
    'client_name', (select coalesce(l.name, ct.name) from crm_leads l left join crm_contacts ct on ct.id = l.contact_id where l.id = v_q.lead_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'description', i.description, 'quantity', i.quantity, 'rate', i.rate, 'amount', i.amount,
                'gst_rate', i.gst_rate, 'taxable', i.taxable, 'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst) order by i.sort_order), '[]'::jsonb)
              from crm_quote_items i where i.quote_id = v_q.id),
    'expired', v_q.valid_until is not null and v_q.valid_until < current_date and v_q.status = 'sent'
  ) into r;
  return r;
end;
$$;
revoke all on function get_quote_for_token(text) from public;
grant execute on function get_quote_for_token(text) to anon, authenticated;
