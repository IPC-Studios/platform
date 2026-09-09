-- The original kept a reusable library of saved note snippets a studio could
-- drop into an invoice's Notes field without retyping it -- independent of
-- the invoice's *print layout*, which already has its own templates
-- (invoice_templates, 0056). This adds the lighter of the two ways to close
-- that gap: a small library for Notes only, additive alongside the existing
-- print-layout system rather than restructuring it.
create table if not exists invoice_note_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  title       text not null,
  content     text not null,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index invoice_note_templates_company_idx on invoice_note_templates (company_id);
drop trigger if exists invoice_note_templates_set_updated_at on invoice_note_templates;
create trigger invoice_note_templates_set_updated_at before update on invoice_note_templates
  for each row execute function set_updated_at();

alter table invoice_note_templates enable row level security;
create policy invoice_note_templates_select on invoice_note_templates for select to authenticated
  using (company_id = get_current_company_id());
create policy invoice_note_templates_write on invoice_note_templates for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
