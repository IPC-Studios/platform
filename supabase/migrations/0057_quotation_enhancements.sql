-- Quotation enhancements: display preferences and print layout.
-- Add display_preferences column to project_quotations.
alter table project_quotations
  add column if not exists display_preferences jsonb not null default '{
    "show_bill_to": true,
    "show_deliverables": true,
    "show_schedule": true,
    "show_cost_summary": true,
    "show_terms": true,
    "show_logo": true,
    "show_gst": true
  }'::jsonb;

-- NOTE: this file used to define issue_quote_link(uuid, int, jsonb) here.
-- It was removed, for two independent reasons:
--
--   1. 0048 already defines issue_quote_link(uuid, int) for CRM quotes. Both
--      have defaults for every parameter past the first, so a one- or
--      two-argument call matched both and Postgres refused it as ambiguous.
--      That broke issuing any CRM quote link -- a shipped feature.
--   2. It inserted into project_quotations (token_hash, valid_days), neither
--      of which is a column on that table, so it could never have run. A
--      plpgsql body is not checked until it executes, which is why creating
--      it appeared to succeed.
--
-- The project-quotation link is issued by issue_project_quotation(uuid, text,
-- int) from 0042, which documents/router.ts calls. Nothing reads
-- display_preferences yet; the column above is kept for when it does.
