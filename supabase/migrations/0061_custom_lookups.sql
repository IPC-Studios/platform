-- Custom lookups: configurable dropdown values for stages, sources, qualities, etc.
create table if not exists custom_lookups (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  category      text not null,
  value         text not null,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, category, value)
);
create index custom_lookups_company_idx on custom_lookups (company_id, category, is_active);

alter table custom_lookups enable row level security;
create policy custom_lookups_select on custom_lookups for select to authenticated
  using (company_id = get_current_company_id());
create policy custom_lookups_write on custom_lookups for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- Seed some default categories
insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'lead_source', v.value, v.sort_order, true
from companies c
cross join (values
  ('manual', 1),
  ('facebook', 2),
  ('instagram', 3),
  ('whatsapp', 4),
  ('website', 5),
  ('google', 6),
  ('referral', 7),
  ('other', 8)
) as v(value, sort_order)
on conflict (company_id, category, value) do nothing;

insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'expense_category', v.value, v.sort_order, true
from companies c
cross join (values
  ('travel', 1),
  ('food', 2),
  ('accommodation', 3),
  ('supplies', 4),
  ('equipment', 5),
  ('communication', 6),
  ('other', 7)
) as v(value, sort_order)
on conflict (company_id, category, value) do nothing;
