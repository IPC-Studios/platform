-- Parity with Lovable: enquiry->lead convert dedupes on email as well as phone,
-- and appends a conversion note so the lead shows where it came from.
create or replace function convert_enquiry_to_lead(
  p_enquiry_id uuid,
  p_notes      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_enq      enquiries;
  v_lead     uuid;
  v_norm     text;
  v_existing uuid;
  v_note     text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_enq from enquiries
   where id = p_enquiry_id and company_id = v_company;
  if v_enq.id is null then
    raise exception 'enquiry not found' using errcode = 'P0001';
  end if;
  if v_enq.converted_lead_id is not null then
    return v_enq.converted_lead_id;
  end if;

  v_norm := crm_normalize_phone(v_enq.phone);
  if v_norm is not null then
    select id into v_existing from crm_leads
     where company_id = v_company and phone_norm = v_norm
     limit 1;
  end if;
  -- Lovable parity: same person by email also joins the existing lead.
  if v_existing is null and v_enq.email is not null and btrim(v_enq.email) <> '' then
    select id into v_existing from crm_leads
     where company_id = v_company and lower(email) = lower(btrim(v_enq.email))
     limit 1;
  end if;

  v_note := coalesce(p_notes, v_enq.message);
  if v_enq.message is not null and p_notes is not null and p_notes <> v_enq.message then
    v_note := 'Converted from enquiry ' || to_char(now(), 'YYYY-MM-DD') || ': ' || left(v_enq.message, 500);
    if p_notes <> '' then
      v_note := p_notes || E'\n\n' || v_note;
    end if;
  elsif v_enq.message is not null and p_notes is null then
    v_note := 'Converted from enquiry ' || to_char(now(), 'YYYY-MM-DD') || ': ' || left(v_enq.message, 500);
  end if;

  if v_existing is not null then
    v_lead := v_existing;
  else
    insert into crm_leads (company_id, name, phone, phone_norm, email, notes, source, status)
    values (
      v_company, v_enq.name, v_enq.phone, v_norm, v_enq.email,
      v_note, 'enquiry', 'new'
    )
    returning id into v_lead;
  end if;

  update enquiries
     set converted_lead_id = v_lead, enquiry_status = 'converted'
   where id = p_enquiry_id;

  return v_lead;
end;
$$;

revoke all on function convert_enquiry_to_lead(uuid, text) from public, anon;
grant execute on function convert_enquiry_to_lead(uuid, text) to authenticated;
