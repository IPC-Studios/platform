-- Lovable parity: the old lead form also captured an alternate phone and the
-- client's city directly on the lead -- useful before a lead is ever linked
-- to a contact record, which is where city already lives today.
alter table crm_leads
  add column if not exists alternate_phone text check (alternate_phone is null or char_length(alternate_phone) <= 30),
  add column if not exists city            text check (city is null or char_length(city) <= 120);
