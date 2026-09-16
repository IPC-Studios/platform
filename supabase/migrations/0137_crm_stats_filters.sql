-- CRM reports you can narrow to one source or one person.
--
-- The old app's Reports tab filters by source and by team member; ours offered
-- a date range and nothing else, so "how is Instagram doing" and "how is Priya
-- doing" were both unanswerable — the two questions a studio owner actually
-- asks of this screen.
--
-- The two new parameters are defaulted, so every existing two-argument caller
-- keeps working. The old two-argument function has to be DROPPED rather than
-- left alongside: two overloads both callable as crm_stats(date, date) is an
-- ambiguous-function error at call time, not a warning.

drop function if exists crm_stats(date, date);

create or replace function crm_stats(
  p_from     date,
  p_to       date,
  p_source   text default null,
  p_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_from timestamptz := p_from::timestamptz;
  v_to   timestamptz := (p_to + 1)::timestamptz;
  -- Blank is "no filter": a select that submits '' should not mean a source
  -- literally named the empty string, which would report zero of everything.
  v_source text := nullif(trim(coalesce(p_source, '')), '');
  v_created int; v_won int; v_lost int;
  r jsonb;
begin
  if v_company is null then return '{}'::jsonb; end if;
  if p_to < p_from then
    raise exception 'range end before start' using errcode = '22023';
  end if;

  select count(*) into v_created from crm_leads
    where company_id = v_company and is_archived = false and created_at >= v_from and created_at < v_to
      and (v_source is null or source::text = v_source)
      and (p_assignee is null or assigned_to = p_assignee);
  select count(*) into v_won from crm_leads
    where company_id = v_company and status = 'converted' and converted_at >= v_from and converted_at < v_to
      and (v_source is null or source::text = v_source)
      and (p_assignee is null or assigned_to = p_assignee);
  select count(*) into v_lost from crm_leads
    where company_id = v_company and status = 'lost' and is_archived = false and stage_changed_at >= v_from and stage_changed_at < v_to
      and (v_source is null or source::text = v_source)
      and (p_assignee is null or assigned_to = p_assignee);

  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', (select count(*) from crm_leads where company_id = v_company and is_archived = false
                and (v_source is null or source::text = v_source)
                and (p_assignee is null or assigned_to = p_assignee)),
    'overdue', (select count(*) from crm_leads where company_id = v_company and is_archived = false
                  and status not in ('converted','lost') and follow_up_at is not null and follow_up_at < now()
                  and (v_source is null or source::text = v_source)
                  and (p_assignee is null or assigned_to = p_assignee)),
    'uncontacted', (select count(*) from crm_leads where company_id = v_company and status = 'new'
                      and last_contacted_at is null and is_archived = false
                      and (v_source is null or source::text = v_source)
                      and (p_assignee is null or assigned_to = p_assignee)),
    'created', v_created,
    'won', v_won,
    'lost', v_lost,
    'conversion_rate', case when v_created = 0 then 0 else round(v_won::numeric / v_created, 4) end,
    'byStatus', (select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
                   from (select status, count(*)::int cnt from crm_leads
                          where company_id = v_company and is_archived = false
                            and (v_source is null or source::text = v_source)
                            and (p_assignee is null or assigned_to = p_assignee)
                          group by status) s),
    'bySource', (select coalesce(jsonb_object_agg(source, cnt), '{}'::jsonb)
                   from (select source, count(*)::int cnt from crm_leads
                          where company_id = v_company and is_archived = false
                            and created_at >= v_from and created_at < v_to
                            and (v_source is null or source::text = v_source)
                            and (p_assignee is null or assigned_to = p_assignee)
                          group by source) s),
    'byLostReason', (select coalesce(jsonb_object_agg(reason, cnt), '{}'::jsonb)
                       from (select coalesce(lost_reason, 'Unspecified') as reason, count(*)::int cnt from crm_leads
                              where company_id = v_company and status = 'lost' and is_archived = false
                                and stage_changed_at >= v_from and stage_changed_at < v_to
                                and (v_source is null or source::text = v_source)
                                and (p_assignee is null or assigned_to = p_assignee)
                              group by 1) s),
    'byCompetitor', (select coalesce(jsonb_object_agg(competitor, cnt), '{}'::jsonb)
                       from (select lost_competitor as competitor, count(*)::int cnt from crm_leads
                              where company_id = v_company and status = 'lost' and is_archived = false and lost_competitor is not null
                                and stage_changed_at >= v_from and stage_changed_at < v_to
                                and (v_source is null or source::text = v_source)
                                and (p_assignee is null or assigned_to = p_assignee)
                              group by 1) s)
  ) into r;
  return r;
end;
$$;

revoke all on function crm_stats(date, date, text, uuid) from public, anon;
grant execute on function crm_stats(date, date, text, uuid) to authenticated;
