-- Platform "New studio" failed every time.
--
-- POST /platform/studios does `insert into companies (name) values (...)`, but
-- companies.owner_user_id is NOT NULL, so the insert raised 23502 and the
-- vendor console could not provision a tenant at all.
--
-- Relaxing the column is the right fix rather than inventing an owner: a
-- vendor-provisioned studio genuinely has no owner until the invited person
-- registers, and putting the platform admin there instead would hand them
-- `is_owner` over a tenant that is not theirs — which gates renewals and other
-- owner-only actions.
--
-- Every existing reader is null-safe: they compare `owner_user_id = auth.uid()`
-- or `= u.user_id` (false for null, which is correct — nobody owns it yet) or
-- coalesce past it. So a null reads as "unclaimed", not as "broken".
alter table companies alter column owner_user_id drop not null;

comment on column companies.owner_user_id is
  'The studio owner. NULL means a vendor-provisioned studio nobody has claimed '
  'yet — no one holds owner rights over it until someone registers against its '
  'platform_studio_invites row.';
