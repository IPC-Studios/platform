-- 0101: Referral parity — per-project campaigns, 6 reward types, archived
-- state, Lovable submission/reward statuses, lead link + source.
-- Additive: new columns + widened checks; old values keep working.

-- ── campaigns ───────────────────────────────────────────────────
alter table referral_campaigns
  add column if not exists project_id uuid references projects (id) on delete set null,
  add column if not exists client_id uuid references clients (id) on delete set null,
  add column if not exists reward_title text check (reward_title is null or char_length(reward_title) <= 160),
  add column if not exists archived_at timestamptz;

-- 6 Lovable reward types alongside the 4 legacy ones.
alter table referral_campaigns drop constraint if exists referral_campaigns_reward_type_check;
alter table referral_campaigns add constraint referral_campaigns_reward_type_check
  check (reward_type in ('percentage', 'fixed', 'credit', 'custom',
                        'cashback', 'free_pre_wedding', 'free_maternity',
                        'extra_album', 'discount'));

alter table referral_campaigns drop constraint if exists referral_campaigns_status_check;
alter table referral_campaigns add constraint referral_campaigns_status_check
  check (status in ('active', 'paused', 'ended', 'archived'));

create index if not exists referral_campaigns_project_idx
  on referral_campaigns (company_id, project_id) where project_id is not null;

-- Backfill a title so the share dialog always has something to show.
update referral_campaigns set reward_title = coalesce(reward_title, name)
 where reward_title is null;

-- One campaign per project: get_or_create is idempotent on this.
create unique index if not exists referral_campaigns_project_unique
  on referral_campaigns (company_id, project_id) where project_id is not null;

-- ── submissions ─────────────────────────────────────────────────
alter table referral_submissions
  add column if not exists project_id uuid references projects (id) on delete set null,
  add column if not exists referring_client_name text check (referring_client_name is null or char_length(referring_client_name) <= 160),
  add column if not exists referred_name text check (referred_name is null or char_length(referred_name) <= 160),
  add column if not exists referred_phone text check (referred_phone is null or char_length(referred_phone) <= 40),
  add column if not exists referred_email text check (referred_email is null or char_length(referred_email) <= 200),
  add column if not exists reward_status text not null default 'not_due'
    check (reward_status in ('not_due', 'due', 'given', 'cancelled')),
  add column if not exists source text not null default 'referral_link'
    check (char_length(source) <= 40),
  add column if not exists crm_lead_id uuid references crm_leads (id) on delete set null;

-- Lovable submission statuses alongside the legacy ones.
alter table referral_submissions drop constraint if exists referral_submissions_status_check;
alter table referral_submissions add constraint referral_submissions_status_check
  check (status in ('pending', 'converted', 'rewarded', 'rejected',
                    'new', 'contacted', 'booked', 'duplicate'));

create index if not exists referral_submissions_reward_idx
  on referral_submissions (company_id, reward_status);
create index if not exists referral_submissions_lead_idx
  on referral_submissions (crm_lead_id) where crm_lead_id is not null;

-- Map legacy rows onto the new vocabulary so filters agree.
update referral_submissions set referred_name = coalesce(referred_name, client_name)
 where referred_name is null;
update referral_submissions set referred_phone = coalesce(referred_phone, client_phone)
 where referred_phone is null;
update referral_submissions set referred_email = coalesce(referred_email, client_email)
 where referred_email is null;
update referral_submissions set referring_client_name = coalesce(referring_client_name, referrer_name)
 where referring_client_name is null;
update referral_submissions
   set reward_status = case when reward_granted then 'given'
                            when status in ('converted', 'rewarded', 'booked') then 'due'
                            else 'not_due' end
 where reward_status = 'not_due';
