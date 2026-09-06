-- 0038: bulk moves to lost carry a reason.
--
-- 0037 made lost_reason mandatory when status = 'lost', but crm_bulk_patch
-- neither accepted nor snapshotted it — so every bulk "Move to lost" died in
-- the trigger with 22023 and the UI had no way to supply one. Both bulk
-- functions now carry the reason; undo restores it exactly (moving away from
-- lost still clears it via the 0037 trigger, so an undo can never strand one).

-- The snapshot gains lost_reason, which changes the return type — Postgres
-- refuses that under CREATE OR REPLACE, so drop first. This is also why the
-- pglite suite (and prod migrate) must apply 0038 cleanly, not partially.
drop function if exists crm_bulk_patch(uuid[], jsonb);
create function crm_bulk_patch(p_ids uuid[], p_patch jsonb)
returns table (id uuid, status text, assigned_to uuid, is_hot boolean, follow_up_at timestamptz, is_archived boolean, lost_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('new','contacted','qualified','proposal_sent','converted','lost') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_patch->>'status' = 'lost'
     and (not (p_patch ? 'lost_reason') or char_length(trim(coalesce(p_patch->>'lost_reason', ''))) < 3) then
    raise exception 'lost_reason required (3-500 chars) when status=lost' using errcode = '22023';
  end if;

  -- What the rows looked like before, handed back so the change can be undone.
  return query
    select l.id, l.status, l.assigned_to, l.is_hot, l.follow_up_at, l.is_archived, l.lost_reason
    from crm_leads l
    where l.id = any(p_ids) and l.company_id = v_company;

  update crm_leads l
     set status = coalesce(p_patch->>'status', l.status),
         assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else l.assigned_to end,
         is_hot = coalesce((p_patch->>'is_hot')::boolean, l.is_hot),
         follow_up_at = case when p_patch ? 'follow_up_at' then nullif(p_patch->>'follow_up_at', '')::timestamptz else l.follow_up_at end,
         is_archived = coalesce((p_patch->>'is_archived')::boolean, l.is_archived),
         lost_reason = case when p_patch ? 'lost_reason' then nullif(p_patch->>'lost_reason', '') else l.lost_reason end,
         converted_at = case
           when p_patch->>'status' = 'converted' then coalesce(l.converted_at, now())
           when p_patch ? 'status' and p_patch->>'status' <> 'converted' then null
           else l.converted_at end,
         last_contacted_at = case
           when p_patch ? 'status' and p_patch->>'status' <> 'new' then coalesce(l.last_contacted_at, now())
           else l.last_contacted_at end
   where l.id = any(p_ids) and l.company_id = v_company;
end;
$$;
revoke all on function crm_bulk_patch(uuid[], jsonb) from public, anon;
grant execute on function crm_bulk_patch(uuid[], jsonb) to authenticated;

-- Undo: each row restored to its own snapshot, reason included.
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
       set status = coalesce(v_row->>'status', l.status),
           assigned_to = nullif(v_row->>'assigned_to', '')::uuid,
           is_hot = coalesce((v_row->>'is_hot')::boolean, l.is_hot),
           follow_up_at = nullif(v_row->>'follow_up_at', '')::timestamptz,
           is_archived = coalesce((v_row->>'is_archived')::boolean, l.is_archived),
           lost_reason = case when v_row ? 'lost_reason' then v_row->>'lost_reason' else l.lost_reason end
     where l.id = (v_row->>'id')::uuid and l.company_id = v_company;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function crm_restore_leads(jsonb) from public, anon;
grant execute on function crm_restore_leads(jsonb) to authenticated;

-- Saved views: only the creator (or the studio owner) may change or remove
-- one. 0037 opened reads to the team but left the company-wide write policy
-- from the first version in place, so anyone could rename anyone's views.
drop policy if exists crm_saved_views_own on crm_saved_views;
drop policy if exists crm_saved_views_write on crm_saved_views;
create policy crm_saved_views_write on crm_saved_views for all to authenticated
using (
  company_id = get_current_company_id() and is_current_user_active()
  and (user_id = auth.uid() or is_current_owner())
)
with check (
  company_id = get_current_company_id() and is_current_user_active()
  and (user_id = auth.uid() or is_current_owner())
);
