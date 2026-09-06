-- 0036: Truly amazing CRM - deal value, lost reason, per-lead SLA, shared views
-- All additive, idempotent

-- deal value + probability (weighted forecast)
alter table crm_leads add column if not exists deal_value numeric(12,2) check (deal_value is null or deal_value >= 0);
alter table crm_leads add column if not exists probability smallint check (probability is null or probability between 0 and 100);
alter table crm_leads add column if not exists lost_reason text check (lost_reason is null or char_length(lost_reason) between 3 and 500);
alter table crm_leads add column if not exists sla_due_at timestamptz;

-- lost_reason only when status = 'lost', cleared otherwise via trigger
create or replace function enforce_lost_reason()
returns trigger language plpgsql as $$
begin
  if new.status = 'lost' and (new.lost_reason is null or char_length(trim(new.lost_reason)) < 3) then
    raise exception 'lost_reason required (3-500 chars) when status=lost' using errcode='22023';
  end if;
  if new.status <> 'lost' then
    new.lost_reason := null;
  end if;
  -- weighted forecast helper: default probability by stage
  if new.probability is null and new.status in ('new','contacted','qualified','proposal_sent','converted','lost') then
    new.probability := case new.status when 'new' then 10 when 'contacted' then 25 when 'qualified' then 50 when 'proposal_sent' then 75 when 'converted' then 100 when 'lost' then 0 end;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_lost_reason_trg on crm_leads;
create trigger enforce_lost_reason_trg before insert or update of status, lost_reason, probability on crm_leads for each row execute function enforce_lost_reason();

-- per-lead SLA: when created, sla_due_at = created_at + sla_hours (from crm_settings or 24h default)
create or replace function set_sla_due_at()
returns trigger language plpgsql as $$
declare hrs int;
begin
  if new.sla_due_at is null then
    select coalesce((select sla_hours from crm_settings where company_id = new.company_id), 24) into hrs;
    new.sla_due_at := new.created_at + make_interval(hours => hrs);
  end if;
  return new;
end;
$$;
drop trigger if exists set_sla_due_at_trg on crm_leads;
create trigger set_sla_due_at_trg before insert on crm_leads for each row execute function set_sla_due_at();

-- breach notification ( hourly cron will call function that checks overdue SLA )
create index if not exists crm_leads_sla_idx on crm_leads(company_id, sla_due_at) where status not in ('converted','lost') and is_archived=false;

-- shared views: visibility
alter table crm_saved_views add column if not exists visibility text not null default 'private' check (visibility in ('private','team','everyone'));
alter table crm_saved_views add column if not exists created_by uuid references auth.users(id);
-- ensure unique name per visibility scope: keep unique (user_id,name) for private, add for team/everyone via partial indexes
create unique index if not exists crm_saved_views_private_unique on crm_saved_views(user_id, name) where visibility='private';
create unique index if not exists crm_saved_views_team_unique on crm_saved_views(company_id, name) where visibility in ('team','everyone');

-- update RLS to allow team/everyone read: previously user_id=auth.uid() only
drop policy if exists crm_saved_views_select on crm_saved_views;
create policy crm_saved_views_select on crm_saved_views for select to authenticated using (
  company_id = get_current_company_id() and (
    user_id = auth.uid() or visibility in ('team','everyone')
  )
);
drop policy if exists crm_saved_views_write on crm_saved_views;
create policy crm_saved_views_write on crm_saved_views for all to authenticated using (
  company_id = get_current_company_id() and is_current_user_active()
) with check (
  company_id = get_current_company_id() and is_current_user_active()
);

-- forecast helper for reports
create or replace function crm_forecast(p_from date, p_to date)
returns table (weighted numeric, total_value numeric, count int)
language sql stable security definer set search_path=public as $$
  select
    coalesce(sum(deal_value * probability / 100.0),0)::numeric,
    coalesce(sum(deal_value),0)::numeric,
    count(*)::int
  from crm_leads where company_id=get_current_company_id()
    and is_archived=false
    and status not in ('lost')
    and created_at::date between p_from and p_to;
$$;
revoke all on function crm_forecast(date,date) from public, anon;
grant execute on function crm_forecast(date,date) to authenticated;
