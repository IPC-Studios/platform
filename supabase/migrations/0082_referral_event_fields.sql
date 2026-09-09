-- The original referral form asked what the referred client's event is,
-- when it is, and how many separate functions it has (haldi, mehendi,
-- wedding, reception...) -- useful context a studio can act on before ever
-- calling the lead back. The submission only carried name/phone/email/notes.
alter table referral_submissions add column if not exists event_type text;
alter table referral_submissions add column if not exists event_date date;
alter table referral_submissions add column if not exists functions_count int
  check (functions_count is null or (functions_count >= 0 and functions_count <= 20));

drop function if exists submit_referral(uuid, text, text, text, text, text, text);

create or replace function submit_referral(
  p_campaign_id     uuid,
  p_client_name     text,
  p_referrer_name   text default null,
  p_referrer_phone  text default null,
  p_client_phone    text default null,
  p_client_email    text default null,
  p_notes           text default null,
  p_event_type      text default null,
  p_event_date      date default null,
  p_functions_count int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_id      uuid;
  v_campaign referral_campaigns;
begin
  select * into v_campaign from referral_campaigns where id = p_campaign_id and status = 'active';
  if v_campaign.id is null then
    raise exception 'campaign not found or inactive' using errcode = 'P0001';
  end if;
  v_company := v_campaign.company_id;

  -- Duplicate check: same phone or email within the same campaign
  if p_client_phone is not null or p_client_email is not null then
    if exists (
      select 1 from referral_submissions
      where campaign_id = p_campaign_id
        and (
          (p_client_phone is not null and client_phone = p_client_phone) or
          (p_client_email is not null and client_email = p_client_email)
        )
    ) then
      raise exception 'duplicate referral' using errcode = '23505';
    end if;
  end if;

  insert into referral_submissions (
    company_id, campaign_id, referrer_name, referrer_phone, client_name, client_phone, client_email, notes,
    event_type, event_date, functions_count
  )
  values (
    v_company, p_campaign_id, p_referrer_name, p_referrer_phone, p_client_name, p_client_phone, p_client_email, p_notes,
    p_event_type, p_event_date, p_functions_count
  )
  returning id into v_id;

  -- Increment click counter on the link
  update referral_links set clicks = clicks + 1 where campaign_id = p_campaign_id;

  return v_id;
end;
$$;

revoke all on function submit_referral(uuid, text, text, text, text, text, text, text, date, int) from public, anon;
grant execute on function submit_referral(uuid, text, text, text, text, text, text, text, date, int) to anon;
grant execute on function submit_referral(uuid, text, text, text, text, text, text, text, date, int) to authenticated;
