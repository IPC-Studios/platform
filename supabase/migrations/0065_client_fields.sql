-- Lovable parity: the old client form captured a free-text "Relation" tag
-- (Referral, Repeat, Vendor...) and this studio needs a client's GSTIN on a
-- compliant B2B tax invoice. Neither has ever had a column.
alter table clients
  add column if not exists relation text check (relation is null or char_length(relation) <= 60),
  add column if not exists gstin    text check (gstin is null or char_length(gstin) <= 20);
