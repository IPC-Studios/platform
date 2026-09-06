-- 0041: CRM quotes, per-person preferences, and the reports the lost reasons
-- and the forecast were collected for.
--
-- A quote is the priced offer on a deal: numbered like an invoice, built
-- from the same line shape (@ipc/domain computeInvoice), sent as a public
-- link the client accepts or declines, and carried into the project when
-- the deal converts. Additive; convert_lead_to_project, crm_stats and
-- crm_forecast change signature or shape and are recreated.

-- ══════════════════════════════════════════════════════════════
-- 1. Per-person preferences: columns, default view, density
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_user_prefs (
  company_id uuid not null references companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
drop trigger if exists crm_user_prefs_set_updated_at on crm_user_prefs;
create trigger crm_user_prefs_set_updated_at before update on crm_user_prefs
  for each row execute function set_updated_at();
alter table crm_user_prefs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_user_prefs_own') then
    create policy crm_user_prefs_own on crm_user_prefs
      for all to authenticated
      using (company_id = get_current_company_id() and user_id = auth.uid())
      with check (company_id = get_current_company_id() and user_id = auth.uid() and is_current_user_active());
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 2. Quotes
-- ══════════════════════════════════════════════════════════════
alter table companies add column if not exists quote_number_prefix text not null default 'Q-';
alter table companies add column if not exists quote_next_number int not null default 1;

create table if not exists crm_quotes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies (id) on delete cascade,
  lead_id            uuid not null references crm_leads (id) on delete cascade,
  contact_id         uuid references crm_contacts (id) on delete set null,
  quote_number       text not null,
  title              text check (title is null or char_length(title) <= 160),
  status             text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  valid_until        date,
  place_of_supply    text,
  intra_state        boolean not null default true,
  subtotal           numeric(12, 2) not null default 0,
  discount           numeric(12, 2) not null default 0,
  taxable            numeric(12, 2) not null default 0,
  tax                numeric(12, 2) not null default 0,
  total              numeric(12, 2) not null default 0,
  notes              text check (notes is null or char_length(notes) <= 4000),
  terms              text check (terms is null or char_length(terms) <= 8000),
  sent_at            timestamptz,
  accepted_at        timestamptz,
  accepted_by_name   text,
  accepted_by_email  text,
  accepted_ip        text,
  accepted_user_agent text,
  declined_at        timestamptz,
  decline_reason     text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, quote_number)
);
create index if not exists crm_quotes_lead_idx on crm_quotes (lead_id, created_at desc);
create index if not exists crm_quotes_company_idx on crm_quotes (company_id, status, created_at desc);
drop trigger if exists crm_quotes_set_updated_at on crm_quotes;
create trigger crm_quotes_set_updated_at before update on crm_quotes
  for each row execute function set_updated_at();

create table if not exists crm_quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references crm_quotes (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  description text not null,
  quantity    numeric(10, 2) not null default 1,
  rate        numeric(12, 2) not null default 0,
  amount      numeric(12, 2) not null default 0,
  gst_rate    numeric(5, 2) not null default 0,
  taxable     numeric(12, 2) not null default 0,
  cgst        numeric(12, 2) not null default 0,
  sgst        numeric(12, 2) not null default 0,
  igst        numeric(12, 2) not null default 0,
  sort_order  int not null default 0
);
create index if not exists crm_quote_items_quote_idx on crm_quote_items (quote_id, sort_order);

alter table crm_quotes      enable row level security;
alter table crm_quote_items enable row level security;
do $$
declare t text;
begin
  foreach t in array array['crm_quotes', 'crm_quote_items'] loop
    if not exists (select 1 from pg_policies where policyname = t || '_select') then
      execute format('create policy %I_select on %I for select to authenticated using (company_id = get_current_company_id());', t, t);
    end if;
    if not exists (select 1 from pg_policies where policyname = t || '_write') then
      execute format('create policy %I_write on %I for all to authenticated
        using (company_id = get_current_company_id() and is_current_user_active())
        with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
    end if;
  end loop;
end $$;

create or replace function next_quote_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_num int;
begin
  update companies
     set quote_next_number = quote_next_number + 1
   where id = get_current_company_id()
  returning quote_number_prefix, quote_next_number - 1 into v_prefix, v_num;
  return v_prefix || lpad(v_num::text, 4, '0');
end;
$$;
revoke all on function next_quote_number() from public, anon;

-- Totals and per-line GST come from @ipc/domain, as they do for invoices;
-- this numbers the quote and stores it in one transaction.
create or replace function create_quote(
  p_lead            uuid,
  p_title           text,
  p_valid_until     date,
  p_place_of_supply text,
  p_intra_state     boolean,
  p_subtotal        numeric,
  p_discount        numeric,
  p_taxable         numeric,
  p_tax             numeric,
  p_total           numeric,
  p_items           jsonb,
  p_notes           text default null,
  p_terms           text default null
)
returns table (id uuid, quote_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_lead    crm_leads;
  v_number  text;
  v_id      uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_lead from crm_leads where crm_leads.id = p_lead and company_id = v_company;
  if not found then raise exception 'unknown lead' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a quote needs at least one line' using errcode = '22023';
  end if;
  v_number := next_quote_number();
  insert into crm_quotes (company_id, lead_id, contact_id, quote_number, title, valid_until, place_of_supply, intra_state,
                          subtotal, discount, taxable, tax, total, notes, terms, created_by)
  values (v_company, p_lead, v_lead.contact_id, v_number, p_title, p_valid_until, p_place_of_supply, p_intra_state,
          p_subtotal, p_discount, p_taxable, p_tax, p_total, p_notes, p_terms, auth.uid())
  returning crm_quotes.id into v_id;

  insert into crm_quote_items (quote_id, company_id, description, quantity, rate, amount, gst_rate, taxable, cgst, sgst, igst, sort_order)
  select v_id, v_company, e ->> 'description',
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(e, ord);

  -- The deal's value follows its latest quote unless someone typed one.
  update crm_leads set deal_value = coalesce(deal_value, p_total) where crm_leads.id = p_lead;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(), 'quote ' || v_number || ' created');
  return query select v_id, v_number;
end;
$$;
revoke all on function create_quote(uuid, text, date, text, boolean, numeric, numeric, numeric, numeric, numeric, jsonb, text, text) from public, anon;
grant execute on function create_quote(uuid, text, date, text, boolean, numeric, numeric, numeric, numeric, numeric, jsonb, text, text) to authenticated;

-- A public link the client accepts or declines through. Sending moves a
-- draft to 'sent', stamps the deal contacted and notes it on the trail.
create or replace function issue_quote_link(p_quote uuid, p_ttl_hours int default 720)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_q crm_quotes;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_q from crm_quotes where id = p_quote and company_id = v_company;
  if not found then raise exception 'unknown quote' using errcode = '42501'; end if;
  if v_q.status in ('accepted', 'declined') then
    raise exception 'This quote is already closed.' using errcode = 'P0001';
  end if;
  update crm_quotes set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_quote;
  update crm_leads set last_contacted_at = coalesce(last_contacted_at, now()) where id = v_q.lead_id;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, v_q.lead_id, null, null, auth.uid(), 'quote ' || v_q.quote_number || ' sent');
  return issue_access_token('quote_accept', p_quote, p_ttl_hours);
end;
$$;
revoke all on function issue_quote_link(uuid, int) from public, anon;
grant execute on function issue_quote_link(uuid, int) to authenticated;

-- Public: what the client sees for a valid token.
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

-- Public: accept (one-time consume) with the evidence the terms flow keeps.
create or replace function accept_quote(p_raw text, p_name text, p_email text default null, p_ip text default null, p_user_agent text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_q crm_quotes;
  v_assignee uuid;
begin
  select id into v_id from crm_quotes q
   where q.status = 'sent'
     and exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                   and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
                   and t.used_at is null and (t.expires_at is null or t.expires_at > now()));
  if v_id is null then return false; end if;
  select * into v_q from crm_quotes where id = v_id;
  if v_q.valid_until is not null and v_q.valid_until < current_date then
    update crm_quotes set status = 'expired' where id = v_id;
    return false;
  end if;
  perform consume_access_token('quote_accept', p_raw);
  update crm_quotes
     set status = 'accepted', accepted_at = now(), accepted_by_name = p_name, accepted_by_email = p_email,
         accepted_ip = p_ip, accepted_user_agent = p_user_agent
   where id = v_id;
  update crm_leads set deal_value = v_q.total where id = v_q.lead_id;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_q.company_id, v_q.lead_id, null, null, null, 'quote ' || v_q.quote_number || ' accepted by ' || coalesce(p_name, 'client'));
  insert into crm_activities (company_id, lead_id, type, direction, subject, actor_id)
  values (v_q.company_id, v_q.lead_id, 'note', 'in', 'Accepted quote ' || v_q.quote_number, null);
  -- An unassigned deal has nobody to tell; notifications.recipient_uid is not null.
  if v_q.lead_id is not null then
    select assigned_to into v_assignee from crm_leads where id = v_q.lead_id;
    if v_assignee is not null then
      perform create_notification(
        v_q.company_id, v_assignee, 'crm_quote',
        'Quote accepted: ' || v_q.quote_number, coalesce(p_name, 'The client') || ' accepted the quote.',
        'crm_quote_accepted:' || v_q.id::text, 'crm_lead', v_q.lead_id);
    end if;
  end if;
  return true;
end;
$$;

create or replace function decline_quote(p_raw text, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_q crm_quotes;
  v_assignee uuid;
begin
  select id into v_id from crm_quotes q
   where q.status = 'sent'
     and exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                   and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
                   and t.used_at is null and (t.expires_at is null or t.expires_at > now()));
  if v_id is null then return false; end if;
  select * into v_q from crm_quotes where id = v_id;
  perform consume_access_token('quote_accept', p_raw);
  update crm_quotes set status = 'declined', declined_at = now(), decline_reason = left(p_reason, 500) where id = v_id;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_q.company_id, v_q.lead_id, null, null, null, 'quote ' || v_q.quote_number || ' declined' || case when p_reason is not null then ': ' || left(p_reason, 200) else '' end);
  -- An unassigned deal has nobody to tell; notifications.recipient_uid is not null.
  select assigned_to into v_assignee from crm_leads where id = v_q.lead_id;
  if v_assignee is not null then
    perform create_notification(
      v_q.company_id, v_assignee, 'crm_quote',
      'Quote declined: ' || v_q.quote_number, nullif(left(p_reason, 200), ''),
      'crm_quote_declined:' || v_q.id::text, 'crm_lead', v_q.lead_id);
  end if;
  return true;
end;
$$;
revoke all on function get_quote_for_token(text) from public;
revoke all on function accept_quote(text, text, text, text, text) from public;
revoke all on function decline_quote(text, text) from public;
grant execute on function get_quote_for_token(text) to anon, authenticated;
grant execute on function accept_quote(text, text, text, text, text) to anon, authenticated;
grant execute on function decline_quote(text, text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. Converting with a quote carries its lines into the project
-- ══════════════════════════════════════════════════════════════
drop function if exists convert_lead_to_project(uuid, uuid, jsonb, jsonb);
create or replace function convert_lead_to_project(
  p_lead      uuid,
  p_client_id uuid default null,
  p_client    jsonb default '{}'::jsonb,
  p_project   jsonb default '{}'::jsonb,
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

-- ══════════════════════════════════════════════════════════════
-- 4. Reports: lost analysis and the forecast's win rate
-- ══════════════════════════════════════════════════════════════
create or replace function crm_stats(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_from timestamptz := p_from::timestamptz;
  v_to   timestamptz := (p_to + 1)::timestamptz;
  v_created int; v_won int; v_lost int;
  r jsonb;
begin
  if v_company is null then return '{}'::jsonb; end if;
  if p_to < p_from then
    raise exception 'range end before start' using errcode = '22023';
  end if;
  select count(*) into v_created from crm_leads
    where company_id = v_company and is_archived = false and created_at >= v_from and created_at < v_to;
  select count(*) into v_won from crm_leads
    where company_id = v_company and status = 'converted' and converted_at >= v_from and converted_at < v_to;
  select count(*) into v_lost from crm_leads
    where company_id = v_company and status = 'lost' and is_archived = false and stage_changed_at >= v_from and stage_changed_at < v_to;

  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', (select count(*) from crm_leads where company_id = v_company and is_archived = false),
    'overdue', (select count(*) from crm_leads where company_id = v_company and is_archived = false
                  and status not in ('converted','lost') and follow_up_at is not null and follow_up_at < now()),
    'uncontacted', (select count(*) from crm_leads where company_id = v_company and status = 'new'
                      and last_contacted_at is null and is_archived = false),
    'created', v_created,
    'won', v_won,
    'lost', v_lost,
    'conversion_rate', case when v_created = 0 then 0 else round(v_won::numeric / v_created, 4) end,
    'byStatus', (select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
                   from (select status, count(*)::int cnt from crm_leads
                          where company_id = v_company and is_archived = false group by status) s),
    'bySource', (select coalesce(jsonb_object_agg(source, cnt), '{}'::jsonb)
                   from (select source, count(*)::int cnt from crm_leads
                          where company_id = v_company and is_archived = false
                            and created_at >= v_from and created_at < v_to group by source) s),
    'byLostReason', (select coalesce(jsonb_object_agg(reason, cnt), '{}'::jsonb)
                       from (select coalesce(lost_reason, 'Unspecified') as reason, count(*)::int cnt from crm_leads
                              where company_id = v_company and status = 'lost' and is_archived = false
                                and stage_changed_at >= v_from and stage_changed_at < v_to group by 1) s),
    'byCompetitor', (select coalesce(jsonb_object_agg(competitor, cnt), '{}'::jsonb)
                       from (select lost_competitor as competitor, count(*)::int cnt from crm_leads
                              where company_id = v_company and status = 'lost' and is_archived = false and lost_competitor is not null
                                and stage_changed_at >= v_from and stage_changed_at < v_to group by 1) s)
  ) into r;
  return r;
end;
$$;

create or replace function crm_forecast(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_won int; v_lost int; v_cycle numeric;
  r jsonb;
begin
  if v_company is null then return '{}'::jsonb; end if;
  if p_to < p_from then raise exception 'range end before start' using errcode = '22023'; end if;
  select count(*) filter (where status = 'converted' and converted_at::date between p_from and p_to),
         count(*) filter (where status = 'lost' and stage_changed_at::date between p_from and p_to),
         round(avg(extract(epoch from (converted_at - created_at)) / 86400) filter (where status = 'converted' and converted_at::date between p_from and p_to)::numeric, 1)
    into v_won, v_lost, v_cycle
    from crm_leads where company_id = v_company and is_archived = false;
  with d as (
    select l.id, l.deal_value, l.probability, l.status, l.assigned_to, l.stage_id,
           coalesce(l.close_date, l.created_at::date) as close_on,
           s.name as stage_name, s.kind, s.position,
           u.name as owner_name,
           coalesce(l.deal_value, 0) * coalesce(l.probability, 0) / 100.0 as weighted
    from crm_leads l
    left join crm_pipeline_stages s on s.id = l.stage_id
    left join users u on u.user_id = l.assigned_to
    where l.company_id = v_company and l.is_archived = false and l.status <> 'lost'
      and coalesce(l.close_date, l.created_at::date) between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'count', (select count(*) from d),
    'total_value', (select coalesce(sum(deal_value), 0) from d),
    'weighted', (select coalesce(sum(weighted), 0) from d),
    'won_value', (select coalesce(sum(deal_value), 0) from d where status = 'converted'),
    'open_value', (select coalesce(sum(deal_value), 0) from d where status <> 'converted'),
    'won_count', v_won,
    'lost_count', v_lost,
    'win_rate', case when v_won + v_lost = 0 then null else round(v_won::numeric / (v_won + v_lost), 4) end,
    'avg_cycle_days', v_cycle,
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object(
                   'stage_id', stage_id, 'name', coalesce(stage_name, 'No stage'), 'kind', coalesce(kind, 'open'),
                   'count', n, 'total_value', total, 'weighted', w) order by position nulls last), '[]'::jsonb)
                 from (select stage_id, stage_name, kind, min(position) as position, count(*) as n,
                              coalesce(sum(deal_value), 0) as total, coalesce(sum(weighted), 0) as w
                       from d group by stage_id, stage_name, kind) x),
    'by_owner', (select coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', assigned_to, 'name', coalesce(owner_name, 'Unassigned'),
                   'count', n, 'total_value', total, 'weighted', w) order by w desc), '[]'::jsonb)
                 from (select assigned_to, owner_name, count(*) as n,
                              coalesce(sum(deal_value), 0) as total, coalesce(sum(weighted), 0) as w
                       from d group by assigned_to, owner_name) x),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object(
                   'month', m, 'count', n, 'total_value', total, 'weighted', w) order by m), '[]'::jsonb)
                 from (select to_char(close_on, 'YYYY-MM') as m, count(*) as n,
                              coalesce(sum(deal_value), 0) as total, coalesce(sum(weighted), 0) as w
                       from d group by 1) x)
  ) into r;
  return r;
end;
$$;

-- Quotes past their date close themselves on the hourly tick.
create or replace function crm_expire_quotes()
returns int
language sql
security definer
set search_path = public
as $$
  with e as (
    update crm_quotes set status = 'expired'
    where status = 'sent' and valid_until is not null and valid_until < current_date
    returning id
  ) select count(*)::int from e;
$$;
revoke all on function crm_expire_quotes() from public, anon;
grant execute on function crm_expire_quotes() to service_role;
