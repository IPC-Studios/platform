-- CRM, phase 2: the columns a follow-up desk actually runs on.
--
-- A lead pipeline is not a list of names, it is a list of promises to call
-- somebody back. Until now a lead carried a stage and nothing about *when* —
-- so "due today", "overdue" and "no follow-up set" could not be asked at all,
-- and every one of them is a filter the desk lives in.
--
--   follow_up_at      the next promised contact. Null means nobody has agreed
--                     to call back, which is its own (bad) state, not "later".
--   last_contacted_at stamped when a lead leaves 'new', so "uncontacted" is a
--                     fact rather than a guess from the stage.
--   converted_at      stamped on the move to 'converted', so "won this month"
--                     survives later edits to the row.
--   is_hot            the human override. Nothing computes this; a person who
--                     has spoken to the client says so.

alter table crm_leads
  add column if not exists follow_up_at      timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists converted_at      timestamptz,
  add column if not exists is_hot            boolean not null default false;

-- A quotation that has gone out is a different conversation from one that has
-- not, and it is the stage studios chase hardest.
alter table crm_leads drop constraint if exists crm_leads_status_check;
alter table crm_leads add constraint crm_leads_status_check
  check (status in ('new', 'contacted', 'qualified', 'proposal_sent', 'converted', 'lost'));

-- The inbox is almost always sorted by what is due, so index that directly.
create index if not exists crm_leads_followup_idx
  on crm_leads (company_id, follow_up_at)
  where status not in ('converted', 'lost');

-- Backfill: rows that already moved past 'new' were contacted at some point,
-- and their updated_at is the closest honest record we have of when.
update crm_leads
   set last_contacted_at = updated_at
 where last_contacted_at is null and status <> 'new';

update crm_leads
   set converted_at = updated_at
 where converted_at is null and status = 'converted';

-- ── manual lead entry ─────────────────────────────────────────
-- The webhook path (capture_lead) is for machines and carries a source key.
-- This is the human one: same dedupe on the normalised phone, same round-robin
-- assignment, but scoped to the caller's own company rather than a key.
create or replace function add_lead(
  p_name    text,
  p_phone   text,
  p_email   text default null,
  p_source  text default 'manual',
  p_notes   text default null,
  p_assign  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_norm     text := crm_normalize_phone(p_phone);
  v_existing uuid;
  v_assignee uuid := p_assign;
  v_lead     uuid;
begin
  if v_company is null then
    raise exception 'no company in scope' using errcode = '42501';
  end if;

  -- Same number, same studio: hand back the lead that already exists rather
  -- than splitting one client's history across two rows.
  if v_norm is not null then
    select id into v_existing from crm_leads
      where company_id = v_company and phone_norm = v_norm
      limit 1;
    if found then return v_existing; end if;
  end if;

  -- Unassigned: give it to whoever on the distribution rota is carrying least.
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

  insert into crm_leads (company_id, name, phone, phone_norm, email, source, notes, assigned_to)
  values (v_company, p_name, p_phone, v_norm, p_email, p_source, p_notes, v_assignee)
  returning id into v_lead;

  return v_lead;
end;
$$;

revoke all on function add_lead(text, text, text, text, text, uuid) from public, anon;
grant execute on function add_lead(text, text, text, text, text, uuid) to authenticated;
