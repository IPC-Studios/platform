-- Lovable parity: the old lead form had Event Type, Event Date and Event
-- Location as first-class fields -- for a photography studio, "wedding, 14
-- Dec, Taj Palace Jaipur" is the first thing a salesperson needs on a lead.
-- crm_leads has never had them, on either side of the flagship rewrite.
alter table crm_leads
  add column if not exists event_type     text check (event_type is null or char_length(event_type) <= 80),
  add column if not exists event_date     date,
  add column if not exists event_location text check (event_location is null or char_length(event_location) <= 200);
