-- Security and consistency fixes for phases 11-14
-- 1. Reminders: restrict RLS to owner sees all, others see own (align with API fix)
drop policy if exists reminders_select on reminders;
create policy reminders_select on reminders for select to authenticated
  using (company_id = get_current_company_id() and (is_current_owner() or user_id = auth.uid()));
drop policy if exists reminders_write on reminders;
create policy reminders_write on reminders for all to authenticated
  using (company_id = get_current_company_id() and (is_current_owner() or user_id = auth.uid()) and is_current_user_active())
  with check (company_id = get_current_company_id() and (is_current_owner() or user_id = auth.uid()) and is_current_user_active());

-- 2. Team payouts: prevent duplicate period per user
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'team_payouts_no_overlap') then
    alter table team_payouts add constraint team_payouts_period_check check (period_end >= period_start);
  end if;
exception when duplicate_object then null; end $$;
create unique index if not exists team_payouts_user_period_uidx on team_payouts (company_id, user_id, period_start, period_end);

-- 3. Custom lookups: ensure new companies get seeds via trigger
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
  return new;
end; $$;
drop trigger if exists trg_seed_lookups on companies;
create trigger trg_seed_lookups after insert on companies for each row execute function seed_custom_lookups_for_company();

-- 4. Activity log: ensure inserts force user_id = auth.uid() via trigger (prevent spoofing)
create or replace function enforce_activity_actor()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from auth.uid() then
    new.user_id := auth.uid();
  end if;
  return new;
end; $$;
drop trigger if exists trg_activity_actor on activity_log;
create trigger trg_activity_actor before insert on activity_log for each row execute function enforce_activity_actor();

-- 5. Invoice templates: ensure only one default per company
create unique index if not exists invoice_templates_one_default_uidx on invoice_templates (company_id) where is_default = true;
