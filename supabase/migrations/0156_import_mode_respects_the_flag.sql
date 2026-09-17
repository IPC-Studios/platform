-- p_skip_duplicates has been doing nothing since 0107.
--
-- 0107 gave crm_import_leads a third parameter, p_mode ('skip' | 'update' |
-- 'create'), and kept the older boolean working by falling back to it:
--
--     v_mode := coalesce(nullif(p_mode, ''),
--                        case when p_skip_duplicates then 'skip' else 'create' end);
--
-- That fallback is unreachable. p_mode was declared `default 'skip'`, so it is
-- never null and never empty, and the coalesce always stops at the first
-- argument. Calling crm_import_leads(rows, false) — "import these even though
-- the numbers are known" — silently skips them instead.
--
-- Nothing in the app hits it: /crm/imports/commit always passes mode
-- explicitly, and the contract defaults it to 'skip'. So this is a trap rather
-- than an outage — two parameters describing one decision, with the one the
-- caller set losing to the one they did not. The same shape as the guards this
-- audit has been pulling out all week, and it would bite the first person who
-- called the function by hand or wrote a second caller from the older
-- signature.
--
-- The default becomes null, which is what makes the fallback reachable:
-- explicit mode wins, otherwise the boolean decides, and a caller passing
-- neither still gets 'skip'.
--
-- The body below is 0107's, lifted verbatim by script rather than retyped.
-- Copying a function body forward by hand is how seed_custom_lookups_for_company
-- lost four picklists in 0139 (see 0154); the only edit here is the default on
-- p_mode.

create or replace function crm_import_leads(p_rows jsonb, p_skip_duplicates boolean default true, p_mode text default null)
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
