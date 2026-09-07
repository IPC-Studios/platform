-- Deliverable sets: the package a studio quotes, saved once.
--
-- Every wedding studio sells two or three packages and then types the same
-- eight line items into every project. A set is that list, shared with the
-- whole team — unlike the lead-time memory beside it in the UI, which is a
-- per-device convenience and deliberately never leaves the browser.
create table if not exists deliverable_sets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  -- The line items, as the wizard writes them: title, whether it is charged on
  -- top, and whether it prints on the quotation. jsonb because it is a
  -- template the UI owns; nothing here is ever queried into.
  items      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- Saving over a name replaces it, so a studio ends up with "Premium", not
  -- "Premium", "Premium (2)", "Premium final".
  unique (company_id, name)
);
create index if not exists deliverable_sets_company_idx on deliverable_sets (company_id, name);

alter table deliverable_sets enable row level security;

create policy deliverable_sets_select on deliverable_sets for select to authenticated
  using (company_id = get_current_company_id());
create policy deliverable_sets_write on deliverable_sets for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
