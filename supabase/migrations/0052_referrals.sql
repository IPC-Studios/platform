-- Referral system: campaigns, submissions, and public referral links.
create table if not exists referral_campaigns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  name              text not null,
  description       text,
  reward_type       text not null default 'fixed'
                      check (reward_type in ('percentage', 'fixed', 'credit', 'custom')),
  reward_value      numeric(12, 2) not null default 0 check (reward_value >= 0),
  reward_description text,
  status            text not null default 'active'
                      check (status in ('active', 'paused', 'ended')),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index referral_campaigns_company_idx on referral_campaigns (company_id, status);
drop trigger if exists referral_campaigns_set_updated_at on referral_campaigns;
create trigger referral_campaigns_set_updated_at before update on referral_campaigns
  for each row execute function set_updated_at();

create table if not exists referral_submissions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  campaign_id       uuid not null references referral_campaigns (id) on delete cascade,
  referrer_name     text,
  referrer_phone    text,
  client_name       text not null,
  client_phone      text,
  client_email      text,
  status            text not null default 'pending'
                      check (status in ('pending', 'converted', 'rewarded', 'rejected')),
  reward_granted    boolean not null default false,
  reward_amount     numeric(12, 2) check (reward_amount is null or reward_amount >= 0),
  notes             text,
  linked_lead_id    uuid references crm_leads (id) on delete set null,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index referral_submissions_company_idx on referral_submissions (company_id, campaign_id, status);
create index referral_submissions_phone_idx on referral_submissions (company_id, client_phone);
drop trigger if exists referral_submissions_set_updated_at on referral_submissions;
create trigger referral_submissions_set_updated_at before update on referral_submissions
  for each row execute function set_updated_at();

-- Public referral links: token-based access for referred clients
create table if not exists referral_links (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  campaign_id       uuid not null references referral_campaigns (id) on delete cascade,
  slug              text not null unique,
  token_hash        text not null,
  clicks            int not null default 0,
  created_at        timestamptz not null default now()
);
create index referral_links_slug_idx on referral_links (slug);

alter table referral_campaigns   enable row level security;
alter table referral_submissions enable row level security;
alter table referral_links       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['referral_campaigns', 'referral_submissions', 'referral_links']
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = get_current_company_id() and is_current_user_active())
         with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
  end loop;
end $$;

-- RPC: create a referral campaign
create or replace function create_referral_campaign(
  p_name              text,
  p_description       text default null,
  p_reward_type       text default 'fixed',
  p_reward_value      numeric default 0,
  p_reward_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into referral_campaigns (company_id, name, description, reward_type, reward_value, reward_description, created_by)
  values (v_company, p_name, p_description, p_reward_type, p_reward_value, p_reward_description, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function create_referral_campaign(text, text, text, numeric, text) from public, anon;
grant execute on function create_referral_campaign(text, text, text, numeric, text) to authenticated;

-- RPC: submit a referral (public, no auth required)
-- Required parameters must precede the defaulted ones; Postgres rejects the
-- reverse. The API calls this with named arguments, so the order is free.
create or replace function submit_referral(
  p_campaign_id    uuid,
  p_client_name    text,
  p_referrer_name  text default null,
  p_referrer_phone text default null,
  p_client_phone   text default null,
  p_client_email   text default null,
  p_notes          text default null
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

  insert into referral_submissions (company_id, campaign_id, referrer_name, referrer_phone, client_name, client_phone, client_email, notes)
  values (v_company, p_campaign_id, p_referrer_name, p_referrer_phone, p_client_name, p_client_phone, p_client_email, p_notes)
  returning id into v_id;

  -- Increment click counter on the link
  update referral_links set clicks = clicks + 1 where campaign_id = p_campaign_id;

  return v_id;
end;
$$;

revoke all on function submit_referral(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function submit_referral(uuid, text, text, text, text, text, text) to anon;
grant execute on function submit_referral(uuid, text, text, text, text, text, text) to authenticated;
