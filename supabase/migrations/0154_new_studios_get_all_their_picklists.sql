-- Every studio created since 0139 is missing four of its six picklists.
--
-- 0139 redefined seed_custom_lookups_for_company() for a good reason: the
-- trigger was plain plpgsql, so it ran as whoever inserted the company, and
-- creating a studio from the platform console failed on the trigger's insert.
-- Making it SECURITY DEFINER was correct.
--
-- What went wrong is what it was redefined FROM. The new body is the 0063
-- version — lead_source and expense_category — and the four categories added
-- afterwards were simply not carried across:
--
--     0084  enquiry_source, payment_type
--     0085  invoice_line_preset
--     0095  enquiry_status
--
-- So since 0139 a new studio has been provisioned with two picklists instead
-- of six. Nothing errors. The Enquiry Source dropdown is just empty, the
-- payment type list is empty, invoice line presets are empty, and enquiry
-- status has no options — in a brand-new studio, where the owner has no
-- reason to suspect the list should have had anything in it.
--
-- This is the same shape as the other definer rewrites in this codebase: a
-- function redefined by copying an older body forward, losing every change
-- made in between. `create or replace` makes it a one-line edit and gives no
-- warning at all.
--
-- It survived because tenancy.test.ts asserts exactly this ("a new studio gets
-- enquiry source and payment type seeded as picklists too") while its
-- freshDb() was pinned at migration 0096 — so the test never ran against 0139.
-- Unpinning it is what surfaced this.

create or replace function seed_custom_lookups_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'lead_source', v.value, v.sort_order, true
  from (values ('manual',1),('facebook',2),('instagram',3),('whatsapp',4),('website',5),('google',6),('referral',7),('other',8)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'expense_category', v.value, v.sort_order, true
  from (values ('travel',1),('food',2),('accommodation',3),('supplies',4),('equipment',5),('communication',6),('other',7)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'enquiry_source', v.value, v.sort_order, true
  from (values ('website',1),('phone',2),('walk_in',3),('instagram',4),('facebook',5),('referral',6),('other',7)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'payment_type', v.value, v.sort_order, true
  from (values ('UPI',1),('Cash',2),('Bank transfer',3),('Cheque',4)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'invoice_line_preset', v.value, v.sort_order, true
  from (values
    ('Wedding Photography Package',1),('Traditional Photography',2),('Candid Photography',3),
    ('Cinematography',4),('Drone Coverage',5),('Pre-Wedding Shoot',6),('Edited Photos',7),
    ('Wedding Film',8),('Highlight Film',9),('Photo Album',10),('Raw Data',11),
    ('Extra Event Coverage',12),('Travel Charges',13),('Same Day Edit',14)
  ) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'enquiry_status', v.value, v.sort_order, true
  from (values ('new',1),('reviewed',2),('contacted',3),('converted',4),('closed',5)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  return new;
end;
$$;

-- ── Give the studios that missed out their lists ─────────────
-- Every existing company, not only those created after 0139: `on conflict do
-- nothing` makes it a no-op for anyone who already has them, and a studio that
-- deleted a value on purpose keeps that decision — the conflict target is the
-- (company_id, category, value) row itself, so only genuinely absent rows are
-- added back.
insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'enquiry_source', v.value, v.sort_order, true
from companies c
cross join (values ('website',1),('phone',2),('walk_in',3),('instagram',4),('facebook',5),('referral',6),('other',7)) as v(value, sort_order)
where not exists (
  select 1 from custom_lookups l where l.company_id = c.id and l.category = 'enquiry_source'
)
on conflict (company_id, category, value) do nothing;

insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'payment_type', v.value, v.sort_order, true
from companies c
cross join (values ('UPI',1),('Cash',2),('Bank transfer',3),('Cheque',4)) as v(value, sort_order)
where not exists (
  select 1 from custom_lookups l where l.company_id = c.id and l.category = 'payment_type'
)
on conflict (company_id, category, value) do nothing;

insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'invoice_line_preset', v.value, v.sort_order, true
from companies c
cross join (values
  ('Wedding Photography Package',1),('Traditional Photography',2),('Candid Photography',3),
  ('Cinematography',4),('Drone Coverage',5),('Pre-Wedding Shoot',6),('Edited Photos',7),
  ('Wedding Film',8),('Highlight Film',9),('Photo Album',10),('Raw Data',11),
  ('Extra Event Coverage',12),('Travel Charges',13),('Same Day Edit',14)
) as v(value, sort_order)
where not exists (
  select 1 from custom_lookups l where l.company_id = c.id and l.category = 'invoice_line_preset'
)
on conflict (company_id, category, value) do nothing;

insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'enquiry_status', v.value, v.sort_order, true
from companies c
cross join (values ('new',1),('reviewed',2),('contacted',3),('converted',4),('closed',5)) as v(value, sort_order)
where not exists (
  select 1 from custom_lookups l where l.company_id = c.id and l.category = 'enquiry_status'
)
on conflict (company_id, category, value) do nothing;
