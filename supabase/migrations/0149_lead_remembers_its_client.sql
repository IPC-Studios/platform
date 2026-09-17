-- A lead converted to a client remembered nothing, and could convert again.
--
-- convert_lead_to_project has two shapes. The one that makes a project records
-- it on the lead as converted_project_id, and the client is reachable from
-- there. The other — "won, project comes later" — creates a client, marks the
-- lead converted, and stores NOTHING: the id is returned to the caller and
-- then dropped. crm_leads had no converted_client_id and clients had no
-- lead_id, so the trail from an enquiry to the client it became ended right
-- at the moment of conversion. Attribution ("which of these clients came from
-- Instagram") is unanswerable for every client-only convert the studio has
-- ever done.
--
-- The second half is worse. The guard against converting twice reads:
--
--     if v_lead.converted_project_id is not null then raise 'already converted'
--
-- ...which the client-only path leaves null. So converting the same lead
-- again is allowed, and it inserts ANOTHER client: one enquiry, two client
-- records, each with its own projects, invoices and payments. Nothing raises,
-- nothing warns, and the duplicate only surfaces when somebody wonders why a
-- client's history looks half-empty.
--
-- Both come from the same omission, so both are fixed by writing the client
-- down and checking it.

alter table crm_leads
  add column if not exists converted_client_id uuid references clients (id) on delete set null;

create index if not exists crm_leads_converted_client_idx
  on crm_leads (company_id, converted_client_id)
  where converted_client_id is not null;

-- Backfill what can be recovered: every lead that made a project knows its
-- client through that project. Leads converted the client-only way cannot be
-- recovered — the link was never written — and stay null.
update crm_leads l
   set converted_client_id = p.client_id
  from projects p
 where p.id = l.converted_project_id
   and l.converted_client_id is null
   and p.client_id is not null;

create or replace function convert_lead_to_project(
  p_lead      uuid,
  p_client_id uuid default null,
  p_client    jsonb default '{}'::jsonb,
  p_project   jsonb default null,
  p_quote     uuid default null
)
returns table (client_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_lead    crm_leads;
  v_quote   crm_quotes;
  v_client  uuid := p_client_id;
  v_project uuid;
  v_name    text;
  v_cost    numeric;
  v_items   jsonb := '[]'::jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_lead from crm_leads where id = p_lead and company_id = v_company;
  if not found then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  -- Either kind of conversion counts. Testing only the project left the
  -- client-only path converting over and over, a new client each time.
  if v_lead.converted_project_id is not null or v_lead.converted_client_id is not null then
    raise exception 'already converted' using errcode = '22023';
  end if;
  if v_lead.phone is null or btrim(v_lead.phone) = '' then
    raise exception 'Add a phone number before converting — it is how the client is found again.' using errcode = 'P0001';
  end if;
  if p_quote is not null then
    select * into v_quote from crm_quotes where id = p_quote and lead_id = p_lead and company_id = v_company;
    if not found then raise exception 'unknown quote' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', i.description, 'list_key', 'primary', 'visibility_scope', 'client', 'show_on_quotation', true,
             'description', case when i.quantity <> 1 then i.quantity::text || ' × ' || i.rate::text else null end
           ) order by i.sort_order), '[]'::jsonb)
      into v_items
      from crm_quote_items i where i.quote_id = p_quote;
  end if;

  if v_client is null then
    insert into clients (company_id, name, email, phone, alternate_phone, address, city, notes, created_by)
    values (
      v_company,
      coalesce(nullif(p_client->>'name', ''), v_lead.name, v_lead.phone, 'New client'),
      coalesce(nullif(p_client->>'email', ''), v_lead.email),
      coalesce(nullif(p_client->>'phone', ''), v_lead.phone),
      nullif(p_client->>'alternate_phone', ''),
      nullif(p_client->>'address', ''),
      nullif(p_client->>'city', ''),
      nullif(p_client->>'notes', ''),
      auth.uid()
    )
    returning id into v_client;
  elsif not exists (select 1 from clients where id = v_client and company_id = v_company) then
    raise exception 'unknown client' using errcode = '42501';
  end if;

  -- Client-only convert: no project (and no quote) — the lead is won and
  -- linked to the client; the project comes later. converted_project_id
  -- stays null, which the UI reads as "client converted, project pending",
  -- and converted_client_id is what says which client that is.
  if (p_project is null or p_project = '{}'::jsonb) and p_quote is null then
    update crm_leads
       set status = 'converted', converted_project_id = null, converted_client_id = v_client
     where id = p_lead;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_lead, null, null, auth.uid(), 'converted to client (no project yet)');
    return query select v_client, null::uuid;
    return;
  end if;

  v_name := coalesce(nullif(p_project->>'name', ''), v_quote.title, v_lead.title, coalesce(v_lead.name, 'New') || ' project');
  v_cost := coalesce((p_project->>'package_cost')::numeric, v_quote.total, v_lead.deal_value, 0);
  v_project := create_project_with_details(
    v_client,
    v_name,
    v_cost,
    coalesce(nullif(p_project->>'status', ''), 'active'),
    p_quote is not null,
    v_items,
    '[]'::jsonb
  );

  update crm_leads
     set status = 'converted', converted_project_id = v_project, converted_client_id = v_client
   where id = p_lead;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(),
          'converted to project: ' || v_name || case when v_quote.id is not null then ' (from quote ' || v_quote.quote_number || ')' else '' end);

  return query select v_client, v_project;
end;
$$;

revoke all on function convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
