-- Invoice templates: customizable layouts for invoice generation.
create table if not exists invoice_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  name          text not null,
  layout_json   jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index invoice_templates_company_idx on invoice_templates (company_id);
drop trigger if exists invoice_templates_set_updated_at on invoice_templates;
create trigger invoice_templates_set_updated_at before update on invoice_templates
  for each row execute function set_updated_at();

-- Add template_id to invoices if not exists
alter table invoices
  add column if not exists template_id uuid references invoice_templates (id) on delete set null;

alter table invoice_templates enable row level security;
create policy invoice_templates_select on invoice_templates for select to authenticated
  using (company_id = get_current_company_id());
create policy invoice_templates_write on invoice_templates for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
