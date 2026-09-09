-- Lovable parity: the old referral program had a public /refer/:slug page a
-- referrer could actually share and land on. The rebuild has the admin side
-- (campaigns, a submissions list) and the submit endpoint, but nothing to
-- generate or hold a shareable link -- there was no slug concept at all.
alter table referral_campaigns
  add column if not exists slug text;

-- Readable and short: "sana-wedding-photo-4f2a", not a hex token. Globally
-- unique -- the public route has no company in the URL to disambiguate with.
create or replace function generate_referral_slug(p_name text)
returns text
language plpgsql
as $$
declare
  v_base text;
  v_slug text;
begin
  v_base := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'referral'; end if;
  v_base := left(v_base, 40);

  loop
    v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    exit when not exists (select 1 from referral_campaigns where slug = v_slug);
  end loop;

  return v_slug;
end;
$$;

update referral_campaigns set slug = generate_referral_slug(name) where slug is null;

alter table referral_campaigns
  alter column slug set not null,
  add constraint referral_campaigns_slug_key unique (slug);

revoke all on function generate_referral_slug(text) from public, anon;
grant execute on function generate_referral_slug(text) to authenticated;

-- ── public lookup by slug ───────────────────────────────────────────────
-- Mirrors submit_referral's shape: no auth, active campaigns only, nothing
-- about the studio beyond what a referrer needs to see.
create or replace function get_public_referral_campaign(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'campaign_id', rc.id,
    'name', rc.name,
    'description', rc.description,
    'reward_type', rc.reward_type,
    'reward_value', rc.reward_value,
    'reward_description', rc.reward_description,
    'studio_name', co.display_name
  )
  from referral_campaigns rc
  join companies co on co.id = rc.company_id
  where rc.slug = p_slug and rc.status = 'active'
$$;

revoke all on function get_public_referral_campaign(text) from public, anon;
grant execute on function get_public_referral_campaign(text) to anon, authenticated;
