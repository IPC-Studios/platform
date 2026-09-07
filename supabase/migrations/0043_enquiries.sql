-- Enquiries: the raw "someone got in touch" list, before anyone works it.
--
-- The CRM already has leads, and a lead is something a person owns and chases.
-- An enquiry is what arrives — a website form, a phone call, a DM — and most
-- of them are never worked at all. Mixing the two makes the lead list a place
-- nobody trusts, which is why the original kept them apart and so does this.
create table if not exists enquiries (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  name              text not null,
  phone             text,
  email             text,
  message           text,
  -- Free text, not an enum: a studio's sources are its own, and the UI offers
  -- the usual ones without forbidding "wedding expo, Jaipur".
  source            text,
  enquiry_status    text not null default 'new'
                      check (enquiry_status in ('new', 'reviewed', 'contacted',
                                                'converted', 'closed')),
  assigned_to       uuid references users (user_id) on delete set null,
  -- Set once it becomes a lead; the enquiry stays as the record of where that
  -- lead came from.
  converted_lead_id uuid references crm_leads (id) on delete set null,
  created_by        uuid references users (user_id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists enquiries_company_status_idx
  on enquiries (company_id, enquiry_status, created_at desc);
-- The list is searched by name, phone and email far more than anything else.
create index if not exists enquiries_search_idx on enquiries (company_id, phone, email);

drop trigger if exists enquiries_set_updated_at on enquiries;
create trigger enquiries_set_updated_at before update on enquiries
  for each row execute function set_updated_at();

alter table enquiries enable row level security;
drop policy if exists enquiries_select on enquiries;
drop policy if exists enquiries_write on enquiries;
create policy enquiries_select on enquiries for select to authenticated
  using (company_id = get_current_company_id());
create policy enquiries_write on enquiries for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- Turning an enquiry into a lead: one step, so a half-converted enquiry with
-- no lead behind it cannot exist.
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
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_enq from enquiries
   where id = p_enquiry_id and company_id = v_company;
  if v_enq.id is null then
    raise exception 'enquiry not found' using errcode = 'P0001';
  end if;
  -- Converting twice would leave two leads chasing one person.
  if v_enq.converted_lead_id is not null then
    return v_enq.converted_lead_id;
  end if;

  -- Same rule the CRM's own intake uses: one number, one lead. An enquiry from
  -- somebody already in the pipeline attaches to the lead that exists rather
  -- than splitting their history in two.
  v_norm := crm_normalize_phone(v_enq.phone);
  if v_norm is not null then
    select id into v_existing from crm_leads
     where company_id = v_company and phone_norm = v_norm
     limit 1;
  end if;

  if v_existing is not null then
    v_lead := v_existing;
  else
    -- `source` is the CRM's own enum and has an 'enquiry' member for exactly
    -- this; where the enquiry itself came from stays on the enquiry row.
    insert into crm_leads (company_id, name, phone, phone_norm, email, notes, source, status)
    values (
      v_company, v_enq.name, v_enq.phone, v_norm, v_enq.email,
      coalesce(p_notes, v_enq.message), 'enquiry', 'new'
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
