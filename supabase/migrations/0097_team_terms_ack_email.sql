-- Parity with Lovable: capture acknowledgement email evidence on team-terms.
alter table team_terms_sends add column if not exists acknowledged_by_email text;

create or replace function acknowledge_team_terms(
  p_raw        text,
  p_name       text,
  p_ip         text default null,
  p_user_agent text default null,
  p_email      text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_send uuid;
begin
  v_send := consume_access_token('team_terms', p_raw);
  if v_send is null then
    return false;
  end if;
  update team_terms_sends
     set status = 'acknowledged', acknowledged_at = now(),
         acknowledged_by_name = p_name, acknowledged_ip = p_ip,
         acknowledged_user_agent = p_user_agent,
         acknowledged_by_email = nullif(p_email, '')
   where id = v_send and revoked_at is null
     and mode = 'acknowledgement_required';
  return found;
end;
$$;

revoke all on function acknowledge_team_terms(text, text, text, text, text) from public;
grant execute on function acknowledge_team_terms(text, text, text, text, text) to anon, authenticated;
-- Keep the old 4-arg signature working for already-deployed callers.
