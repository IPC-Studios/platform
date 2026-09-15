-- 0104: Lovable parity function updates — bulk patch, import, duplicates,
-- capture defaults, client-only convert, reminder filters. Additive:
-- every changed function keeps its old call shape working.

-- ── 1. bulk patch: quality / contacted / group / note ───────────
drop function if exists crm_bulk_patch(uuid[], jsonb);
create function crm_bulk_patch(p_ids uuid[], p_patch jsonb)
returns table (
  id uuid, status text, assigned_to uuid, is_hot boolean, follow_up_at timestamptz, is_archived boolean,
  deal_value numeric, probability smallint, lost_reason text, lost_competitor text, stage_id uuid, close_date date,
  quality text, contacted_status text, group_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_pipeline uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('new','contacted','qualified','proposal_sent','converted','lost') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_patch ? 'quality' and p_patch->>'quality' is not null
     and p_patch->>'quality' not in ('hot', 'warm', 'cold') then
    raise exception 'unknown quality' using errcode = '22023';
  end if;
  if p_patch ? 'contacted_status' and p_patch->>'contacted_status' not in ('uncontacted', 'contacted', 'unreachable') then
    raise exception 'unknown contacted_status' using errcode = '22023';
  end if;
  if p_patch ? 'stage_id' then
    select s.pipeline_id into v_pipeline from crm_pipeline_stages s
     where s.id = (p_patch->>'stage_id')::uuid and s.company_id = v_company;
    if v_pipeline is null then
      raise exception 'unknown stage' using errcode = '22023';
    end if;
    if exists (
      select 1 from crm_leads l
      where l.id = any(p_ids) and l.company_id = v_company and l.pipeline_id is distinct from v_pipeline
    ) then
      raise exception 'That stage belongs to another pipeline.' using errcode = 'P0001';
    end if;
  end if;

  return query
    select l.id, l.status, l.assigned_to, l.is_hot, l.follow_up_at, l.is_archived,
           l.deal_value, l.probability, l.lost_reason, l.lost_competitor, l.stage_id, l.close_date,
           l.quality, l.contacted_status, l.group_name
    from crm_leads l
    where l.id = any(p_ids) and l.company_id = v_company;

  update crm_leads l
     set status = coalesce(p_patch->>'status', l.status),
         stage_id = case when p_patch ? 'stage_id' then (p_patch->>'stage_id')::uuid else l.stage_id end,
         lost_reason = case when p_patch ? 'lost_reason' then nullif(p_patch->>'lost_reason', '') else l.lost_reason end,
         lost_competitor = case when p_patch ? 'lost_competitor' then nullif(p_patch->>'lost_competitor', '') else l.lost_competitor end,
         assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else l.assigned_to end,
         is_hot = coalesce((p_patch->>'is_hot')::boolean, l.is_hot),
         quality = case when p_patch ? 'quality' then nullif(p_patch->>'quality', '') else l.quality end,
         contacted_status = coalesce(nullif(p_patch->>'contacted_status', ''), l.contacted_status),
         group_name = case when p_patch ? 'group_name' then nullif(p_patch->>'group_name', '') else l.group_name end,
         notes = case when p_patch ? 'note' and nullif(p_patch->>'note', '') is not null
                      then nullif(trim(coalesce(l.notes, '') || chr(10) || (p_patch->>'note')), '')
                      else l.notes end,
         follow_up_at = case when p_patch ? 'follow_up_at' then nullif(p_patch->>'follow_up_at', '')::timestamptz else l.follow_up_at end,
         is_archived = coalesce((p_patch->>'is_archived')::boolean, l.is_archived),
         deal_value = case when p_patch ? 'deal_value' then nullif(p_patch->>'deal_value', '')::numeric else l.deal_value end,
         probability = case when p_patch ? 'probability' then nullif(p_patch->>'probability', '')::smallint else l.probability end,
         close_date = case when p_patch ? 'close_date' then nullif(p_patch->>'close_date', '')::date else l.close_date end
   where l.id = any(p_ids) and l.company_id = v_company;
end;
$$;
revoke all on function crm_bulk_patch(uuid[], jsonb) from public, anon;
grant execute on function crm_bulk_patch(uuid[], jsonb) to authenticated;

create or replace function crm_restore_leads(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_row jsonb;
  v_n int := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    update crm_leads l
       set stage_id = coalesce(nullif(v_row->>'stage_id', '')::uuid, l.stage_id),
           status = coalesce(v_row->>'status', l.status),
           lost_reason = case when v_row ? 'lost_reason' then nullif(v_row->>'lost_reason', '') else l.lost_reason end,
           lost_competitor = case when v_row ? 'lost_competitor' then nullif(v_row->>'lost_competitor', '') else l.lost_competitor end,
           assigned_to = nullif(v_row->>'assigned_to', '')::uuid,
           is_hot = coalesce((v_row->>'is_hot')::boolean, l.is_hot),
           quality = case when v_row ? 'quality' then nullif(v_row->>'quality', '') else l.quality end,
           contacted_status = case when v_row ? 'contacted_status' then nullif(v_row->>'contacted_status', '') else l.contacted_status end,
           group_name = case when v_row ? 'group_name' then nullif(v_row->>'group_name', '') else l.group_name end,
           follow_up_at = nullif(v_row->>'follow_up_at', '')::timestamptz,
           is_archived = coalesce((v_row->>'is_archived')::boolean, l.is_archived),
           deal_value = case when v_row ? 'deal_value' then nullif(v_row->>'deal_value', '')::numeric else l.deal_value end,
           probability = case when v_row ? 'probability' then nullif(v_row->>'probability', '')::smallint else l.probability end,
           close_date = case when v_row ? 'close_date' then nullif(v_row->>'close_date', '')::date else l.close_date end
     where l.id = (v_row->>'id')::uuid and l.company_id = v_company;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

-- ── 2. import: richer columns + update mode + per-row errors ────
drop function if exists crm_import_leads(jsonb, boolean);
create function crm_import_leads(p_rows jsonb, p_skip_duplicates boolean default true, p_mode text default 'skip')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_mode     text := coalesce(nullif(p_mode, ''), case when p_skip_duplicates then 'skip' else 'create' end);
  v_row      jsonb;
  v_idx      int := 0;
  v_norm     text;
  v_email    text;
  v_existing uuid;
  v_assignee uuid;
  v_id       uuid;
  v_created  int := 0;
  v_skipped  int := 0;
  v_updated  int := 0;
  v_invalid  int := 0;
  v_ids      uuid[] := '{}';
  v_errors   jsonb := '[]'::jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_mode not in ('skip', 'update', 'create') then
    raise exception 'unknown import mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be an array of at most 500' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      v_norm := crm_normalize_phone(v_row->>'phone');
      if v_norm is null then
        v_invalid := v_invalid + 1;
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'Not a valid phone number');
        continue;
      end if;
      v_email := nullif(trim(coalesce(v_row->>'email', '')), '');

      select id into v_existing from crm_leads
        where company_id = v_company and phone_norm = v_norm and is_archived = false
        limit 1;

      if v_existing is not null and v_mode = 'skip' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if v_existing is not null and v_mode = 'update' then
        update crm_leads set
          name = coalesce(nullif(v_row->>'name', ''), name),
          email = coalesce(v_email, email),
          notes = case when nullif(v_row->>'notes', '') is not null
                       then nullif(trim(coalesce(notes, '') || chr(10) || (v_row->>'notes')), '')
                       else notes end,
          city = coalesce(nullif(v_row->>'city', ''), city),
          event_type = coalesce(nullif(v_row->>'event_type', ''), event_type),
          event_date = coalesce(nullif(v_row->>'event_date', '')::date, event_date),
          event_location = coalesce(nullif(v_row->>'event_location', ''), event_location),
          deal_value = coalesce(nullif(v_row->>'deal_value', '')::numeric, deal_value),
          group_name = coalesce(nullif(v_row->>'group_name', ''), group_name),
          alternate_phone = coalesce(nullif(v_row->>'alternate_phone', ''), alternate_phone),
          quality = coalesce(nullif(v_row->>'quality', ''), quality)
        where id = v_existing;
        v_updated := v_updated + 1;
        continue;
      end if;

      v_assignee := nullif(v_row->>'assigned_to', '')::uuid;
      if v_assignee is null then
        select r.user_id into v_assignee
          from crm_distribution_rules r
          where r.company_id = v_company and r.is_active
          order by (
            select count(*) from crm_leads l
            where l.company_id = v_company and l.assigned_to = r.user_id
          ) asc, r.priority asc
          limit 1;
      end if;

      insert into crm_leads (company_id, name, phone, phone_norm, email, source, notes, assigned_to,
                             source_key, city, event_type, event_date, event_location,
                             deal_value, group_name, alternate_phone, quality)
      values (
        v_company,
        nullif(v_row->>'name', ''),
        v_row->>'phone',
        v_norm,
        v_email,
        coalesce(nullif(v_row->>'source', ''), 'manual'),
        nullif(v_row->>'notes', ''),
        v_assignee,
        'csv_import',
        nullif(v_row->>'city', ''),
        nullif(v_row->>'event_type', ''),
        nullif(v_row->>'event_date', '')::date,
        nullif(v_row->>'event_location', ''),
        nullif(v_row->>'deal_value', '')::numeric,
        nullif(v_row->>'group_name', ''),
        nullif(v_row->>'alternate_phone', ''),
        nullif(v_row->>'quality', '')
      )
      returning id into v_id;
      v_ids := v_ids || v_id;
      v_created := v_created + 1;
    exception when others then
      v_invalid := v_invalid + 1;
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', left(sqlerrm, 200));
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'updated', v_updated,
                            'invalid', v_invalid, 'ids', to_jsonb(v_ids), 'errors', v_errors);
end;
$$;
revoke all on function crm_import_leads(jsonb, boolean, text) from public, anon;
grant execute on function crm_import_leads(jsonb, boolean, text) to authenticated;

-- ── 3. duplicates: email groups + masked value + quality/assignee ──
drop function if exists crm_duplicate_groups();
create or replace function crm_duplicate_groups()
returns table (phone_norm text, match_type text, match_value_masked text,
               lead_ids uuid[], lead_count int, leads jsonb)
language sql
security definer
set search_path = public
as $$
  with phone_groups as (
    select l.phone_norm as key, 'phone'::text as mtype,
           array_agg(l.id order by l.created_at) as ids, count(*)::int as n
    from crm_leads l
    where l.company_id = get_current_company_id()
      and l.phone_norm is not null and l.is_archived = false
    group by l.phone_norm having count(*) > 1
  ),
  email_groups as (
    select lower(l.email) as key, 'email'::text as mtype,
           array_agg(l.id order by l.created_at) as ids, count(*)::int as n
    from crm_leads l
    where l.company_id = get_current_company_id()
      and nullif(trim(l.email), '') is not null and l.is_archived = false
    group by lower(l.email) having count(*) > 1
  ),
  groups as (
    select * from phone_groups
    union all
    select * from email_groups
    order by n desc limit 50
  )
  select g.key, g.mtype,
         case when g.mtype = 'phone'
              then '••••••' || right(regexp_replace(g.key, '\D', '', 'g'), 4)
              else left(split_part(g.key, '@', 1), 2) || '•••@' || split_part(g.key, '@', 2) end,
         g.ids, g.n,
         (select jsonb_agg(jsonb_build_object(
            'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
            'quality', l.quality, 'contacted_status', l.contacted_status,
            'assigned_to', l.assigned_to, 'assignee_name', u.name,
            'status', l.status, 'source', l.source,
            'created_at', l.created_at, 'notes', l.notes
          ) order by l.created_at)
          from crm_leads l left join users u on u.user_id = l.assigned_to
          where l.id = any(g.ids))
  from groups g;
$$;
revoke all on function crm_duplicate_groups() from public, anon;
grant execute on function crm_duplicate_groups() to authenticated;

-- keep_separate: remember the decision so the pair stops surfacing.
-- Implemented as an event note on the survivor (additive — no new table).
create or replace function resolve_crm_duplicates(p_survivor uuid, p_duplicates uuid[], p_action text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
  v_n int := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('keep_separate', 'archive') then
    raise exception 'unknown resolve action' using errcode = '22023';
  end if;
  if not exists (select 1 from crm_leads where id = p_survivor and company_id = v_company) then
    raise exception 'unknown survivor' using errcode = '42501';
  end if;
  foreach v_id in array p_duplicates loop
    if v_id = p_survivor then continue; end if;
    if not exists (select 1 from crm_leads where id = v_id and company_id = v_company and is_archived = false) then
      continue;
    end if;
    if p_action = 'archive' then
      update crm_leads set is_archived = true, archived_at = now(), merged_into = p_survivor
       where id = v_id and company_id = v_company;
    end if;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_survivor, null, null, auth.uid(),
            case when p_action = 'archive' then 'archived duplicate ' || v_id::text
                 else 'kept separate from ' || v_id::text end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function resolve_crm_duplicates(uuid, uuid[], text) from public, anon;
grant execute on function resolve_crm_duplicates(uuid, uuid[], text) to authenticated;

-- ── 4. capture: per-source defaults + receipt stamp ─────────
create or replace function capture_lead(
  p_source_key text,
  p_name       text,
  p_phone      text,
  p_email      text default null,
  p_meta       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   crm_webhook_sources;
  v_norm     text := crm_normalize_phone(p_phone);
  v_existing uuid;
  v_assignee uuid;
  v_lead     uuid;
  v_default_pipeline uuid;
  v_stage    uuid;
begin
  select * into v_source from crm_webhook_sources
    where source_key = p_source_key and is_active;
  if not found then
    raise exception 'unknown or inactive source' using errcode = '42501';
  end if;

  update crm_webhook_sources set last_received_at = now() where id = v_source.id;

  if v_norm is not null then
    select id into v_existing from crm_leads
      where company_id = v_source.company_id and phone_norm = v_norm
      limit 1;
    if found then return v_existing; end if;
  end if;

  -- Per-source default assignee wins; otherwise the lightest-loaded rota member.
  v_assignee := v_source.default_assigned_to;
  if v_assignee is null then
    select r.user_id into v_assignee
      from crm_distribution_rules r
      where r.company_id = v_source.company_id and r.is_active
      order by (
        select count(*) from crm_leads l
        where l.company_id = v_source.company_id and l.assigned_to = r.user_id
      ) asc, r.priority asc
      limit 1;
  end if;

  insert into crm_leads (
    company_id, name, phone, phone_norm, email, source, source_key, assigned_to, source_meta, quality
  )
  values (
    v_source.company_id, p_name, p_phone, v_norm, p_email,
    coalesce(v_source.default_source, case when v_source.kind = 'meta' then 'facebook' else 'webform' end),
    v_source.source_key, v_assignee, coalesce(p_meta, '{}'::jsonb),
    v_source.default_quality
  )
  returning id into v_lead;

  -- Per-source default stage (a legacy status key like 'contacted').
  if v_source.default_stage is not null then
    select id into v_default_pipeline from crm_pipelines
     where company_id = v_source.company_id and is_default;
    if v_default_pipeline is not null then
      v_stage := crm_stage_for_status(v_default_pipeline, v_source.default_stage);
      if v_stage is not null then
        update crm_leads set stage_id = v_stage where id = v_lead;
      end if;
    end if;
  end if;

  return v_lead;
end;
$$;

-- ── 5. convert: client-only (no project yet) ─────────────────
drop function if exists convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid);
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
  if v_lead.converted_project_id is not null then
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
  -- stays null, which the UI reads as "client converted, project pending".
  if (p_project is null or p_project = '{}'::jsonb) and p_quote is null then
    update crm_leads set status = 'converted', converted_project_id = null where id = p_lead;
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

  update crm_leads set status = 'converted', converted_project_id = v_project where id = p_lead;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(),
          'converted to project: ' || v_name || case when v_quote.id is not null then ' (from quote ' || v_quote.quote_number || ')' else '' end);

  return query select v_client, v_project;
end;
$$;
revoke all on function convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function convert_lead_to_project(uuid, uuid, jsonb, jsonb, uuid) to authenticated;

-- ── 6. reminders: entity / due / assignee / search / pagination ──
drop function if exists list_reminders(text, text, uuid);
create or replace function list_reminders(
  p_status      text default null,
  p_priority    text default null,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_due_from    timestamptz default null,
  p_due_to      timestamptz default null,
  p_overdue     boolean default null,
  p_search      text default null,
  p_limit       int default 50,
  p_cursor      timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_items   jsonb;
  v_summary jsonb;
  v_needle  text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_needle := case when nullif(trim(coalesce(p_search, '')), '') is null
                   then null else '%' || trim(p_search) || '%' end;

  select jsonb_agg(row_to_json(r)) into v_items
  from (
    select rm.id, rm.company_id, rm.user_id, rm.created_by, rm.title, rm.description, rm.priority, rm.status,
           rm.entity_type, rm.entity_id, rm.due_at, rm.created_at,
           case rm.entity_type
             when 'lead' then (select name from crm_leads where id = rm.entity_id)
             when 'project' then (select name from projects where id = rm.entity_id)
             when 'client' then (select name from clients where id = rm.entity_id)
             when 'invoice' then (select invoice_number from invoices where id = rm.entity_id)
             when 'enquiry' then (select name from enquiries where id = rm.entity_id)
             when 'task' then (select title from tasks where id = rm.entity_id)
             when 'shoot' then (select name from shoots where id = rm.entity_id)
             else null
           end as entity_name
      from reminders rm
     where rm.company_id = v_company
       and (p_status is null or rm.status = p_status)
       and (p_priority is null or rm.priority = p_priority)
       and (p_user_id is null or rm.user_id = p_user_id)
       and (p_entity_type is null or rm.entity_type = p_entity_type)
       and (p_entity_id is null or rm.entity_id = p_entity_id)
       and (p_due_from is null or rm.due_at >= p_due_from)
       and (p_due_to is null or rm.due_at <= p_due_to)
       and (p_overdue is null or not p_overdue or (rm.status = 'active' and rm.due_at < now()))
       and (v_needle is null or rm.title ilike v_needle or coalesce(rm.description, '') ilike v_needle)
       and (p_cursor is null or rm.created_at < p_cursor)
     order by
       case rm.priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
       rm.due_at nulls last,
       rm.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 50))
  ) r;

  select jsonb_build_object(
    'total_count', count(*)::int,
    'active_count', count(*) filter (where status = 'active')::int,
    'overdue_count', count(*) filter (where status = 'active' and due_at < now())::int,
    'due_today_count', count(*) filter (where status = 'active' and due_at::date = current_date)::int
  ) into v_summary
  from reminders
  where company_id = v_company and (p_user_id is null or user_id = p_user_id);

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary
  );
end;
$$;
revoke all on function list_reminders(text, text, uuid, text, uuid, timestamptz, timestamptz, boolean, text, int, timestamptz) from public, anon;
grant execute on function list_reminders(text, text, uuid, text, uuid, timestamptz, timestamptz, boolean, text, int, timestamptz) to authenticated;
