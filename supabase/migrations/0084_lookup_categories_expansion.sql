-- Two more free-text fields that the original let a studio manage as a
-- picklist, same as lead_source and expense_category already are (0061):
-- how an enquiry reached the studio, and how a payment was made.
insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'enquiry_source', v.value, v.sort_order, true
from companies c
cross join (values
  ('website', 1),
  ('phone', 2),
  ('walk_in', 3),
  ('instagram', 4),
  ('facebook', 5),
  ('referral', 6),
  ('other', 7)
) as v(value, sort_order)
on conflict (company_id, category, value) do nothing;

insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'payment_type', v.value, v.sort_order, true
from companies c
cross join (values
  ('UPI', 1),
  ('Cash', 2),
  ('Bank transfer', 3),
  ('Cheque', 4)
) as v(value, sort_order)
on conflict (company_id, category, value) do nothing;

-- A company registered after today needs the same two categories, not just
-- the two 0063's trigger already knew about.
create or replace function seed_custom_lookups_for_company()
returns trigger language plpgsql as $$
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
  return new;
end; $$;
