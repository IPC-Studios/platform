-- Lovable parity: separate invoice logo + document footer note on companies.
-- Additive; existing rows keep behaviour (both default null).
alter table companies add column if not exists document_footer_note text;
alter table companies add column if not exists invoice_logo_url text;
