-- Quotation enhancements: display preferences and print layout.
-- Add display_preferences column to project_quotations.
alter table project_quotations
  add column if not exists display_preferences jsonb not null default '{
    "show_bill_to": true,
    "show_deliverables": true,
    "show_schedule": true,
    "show_cost_summary": true,
    "show_terms": true,
    "show_logo": true,
    "show_gst": true
  }'::jsonb;

-- Update the quotation issue function to accept display preferences
create or replace function issue_quote_link(
  p_project_id          uuid,
  p_valid_days          int default 7,
  p_display_preferences jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_token    text;
  v_hash     text;
  v_id       uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Generate a random token
  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(v_token::bytea), 'hex');

  insert into project_quotations (company_id, project_id, token_hash, valid_days, display_preferences)
  values (v_company, p_project_id, v_hash, p_valid_days,
          coalesce(p_display_preferences, (select display_preferences from project_quotations where project_id = p_project_id limit 1)))
  returning id into v_id;

  return v_token;
end;
$$;

revoke all on function issue_quote_link(uuid, int, jsonb) from public, anon;
grant execute on function issue_quote_link(uuid, int, jsonb) to authenticated;
