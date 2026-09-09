-- Two small gaps found comparing against the original app's lead form:
-- 1. group_name (a free-text segment tag, e.g. "Hot Lead, Already Booked") had
--    no equivalent field at all -- lost entirely in the rebuild.
-- 2. The manual "add a lead by hand" source dropdown could only say
--    facebook/webform/referral/manual/enquiry; a lead that actually came in
--    over Instagram DM, WhatsApp, a Google Form, or a CSV import had to be
--    misattributed as "manual", losing real channel-attribution data.
alter table crm_leads add column if not exists group_name text check (group_name is null or char_length(group_name) <= 120);

alter table crm_leads drop constraint if exists crm_leads_source_check;
alter table crm_leads add constraint crm_leads_source_check
  check (source in ('facebook', 'webform', 'referral', 'manual', 'enquiry', 'instagram', 'whatsapp', 'google_form', 'csv_import', 'other'));
