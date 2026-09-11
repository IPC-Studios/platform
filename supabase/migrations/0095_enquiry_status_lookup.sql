-- Enquiry status becomes a studio-editable picklist, same mechanism as
-- lead_source/expense_category/enquiry_source/payment_type (0061, 0084):
-- the fixed CHECK constraint blocked a studio from ever adding its own
-- status (e.g. "Quoted", "Needs manager review") the way the old app let
-- them. The 5 system values keep their exact meaning everywhere that reads
-- them literally (summary buckets, the open/closed split, conversion) --
-- this only stops the column from refusing anything else.
alter table enquiries drop constraint if exists enquiries_enquiry_status_check;
alter table enquiries add constraint enquiries_enquiry_status_check
  check (length(trim(enquiry_status)) > 0);

insert into custom_lookups (company_id, category, value, sort_order, is_active)
select c.id, 'enquiry_status', v.value, v.sort_order, true
from companies c
cross join (values
  ('new', 1),
  ('reviewed', 2),
  ('contacted', 3),
  ('converted', 4),
  ('closed', 5)
) as v(value, sort_order)
on conflict (company_id, category, value) do nothing;

-- A company registered after today needs the same seed as the other five
-- categories this trigger already knows about (this redefinition is based on
-- 0085's version, the latest before this one -- it already added
-- invoice_line_preset on top of 0084's four; basing this off 0084 instead
-- would have quietly dropped that block).
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
end; $$;
