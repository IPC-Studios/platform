-- Lead sources: naming them, and knowing which one actually works.
--
-- A source row was a key and a kind — enough for the webhook to resolve a
-- tenant, useless to the person deciding where next month's ad money goes.
-- Two additions fix that:
--
--   label            what a human calls it ("Website contact form", "Meta —
--                    Wedding campaign"). The key stays the machine's name.
--   crm_leads.source_key  which source a lead actually came through. `source`
--                    only ever said 'facebook' or 'webform', so two campaigns
--                    on the same channel were indistinguishable — and "which
--                    campaign is working" is the whole question.

alter table crm_webhook_sources
  add column if not exists label text;

-- Existing rows get their key as a name so nothing renders blank.
update crm_webhook_sources set label = source_key where label is null;

alter table crm_leads
  add column if not exists source_key text;

create index if not exists crm_leads_source_key_idx
  on crm_leads (company_id, source_key);

-- ── capture_lead now records which source it came through ─────
-- Same signature and behaviour as 0013 otherwise: resolve the tenant from the
-- key, dedupe on the normalised phone, auto-assign to the lightest-loaded
-- member of the rota.
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
begin
  select * into v_source from crm_webhook_sources
    where source_key = p_source_key and is_active;
  if not found then
    raise exception 'unknown or inactive source' using errcode = '42501';
  end if;

  -- Dedupe: same normalized phone in this company -> return the existing lead.
  if v_norm is not null then
    select id into v_existing from crm_leads
      where company_id = v_source.company_id and phone_norm = v_norm
      limit 1;
    if found then return v_existing; end if;
  end if;

  -- Assign to the active distribution member with the fewest current leads.
  select r.user_id into v_assignee
    from crm_distribution_rules r
    where r.company_id = v_source.company_id and r.is_active
    order by (
      select count(*) from crm_leads l
      where l.company_id = v_source.company_id and l.assigned_to = r.user_id
    ) asc, r.priority asc
    limit 1;

  insert into crm_leads (
    company_id, name, phone, phone_norm, email, source, source_key, assigned_to, source_meta
  )
  values (
    v_source.company_id, p_name, p_phone, v_norm, p_email,
    case when v_source.kind = 'meta' then 'facebook' else 'webform' end,
    v_source.source_key, v_assignee, coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_lead;
  return v_lead;
end;
$$;

revoke all on function capture_lead(text, text, text, text, jsonb) from public;
grant execute on function capture_lead(text, text, text, text, jsonb) to anon, authenticated;

-- ── creating a source ─────────────────────────────────────────
-- The key is minted server-side and is the only secret involved: anyone holding
-- it can post leads into this studio, so it is never taken from the client.
create or replace function create_lead_source(p_label text, p_kind text default 'webform')
returns crm_webhook_sources
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_key     text;
  v_row     crm_webhook_sources;
begin
  if v_company is null then
    raise exception 'no company in scope' using errcode = '42501';
  end if;
  if p_kind not in ('webform', 'meta') then
    raise exception 'unknown source kind' using errcode = '22023';
  end if;

  -- Long enough that guessing one is not worth anybody's afternoon.
  v_key := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into crm_webhook_sources (company_id, source_key, kind, label)
  values (v_company, v_key, p_kind, nullif(trim(p_label), ''))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function create_lead_source(text, text) from public, anon;
grant execute on function create_lead_source(text, text) to authenticated;
