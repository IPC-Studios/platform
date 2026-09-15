-- Attaching a receipt to an expense has never worked.
--
-- 0012 created expense_attachments with a single `url` column. 0119 tried to
-- redefine it with file_name / file_url / file_size / mime_type / created_by
-- using `create table if not exists` — which, against a table that already
-- exists, does nothing at all. No error, no columns.
--
-- So the reader selected five columns that do not exist and threw; a bare
-- `catch { return [] }` in the router turned that into "no attachments yet",
-- which is indistinguishable from the truth. The writer threw too, so nothing
-- could ever be attached to disagree with it.
--
-- This is the same shape as 0126 and 0131: the name is inside a template
-- literal, so nothing static could see it. `supabase/tests/schema-drift.test.ts`
-- now fails on a `create table if not exists` that silently disagrees with the
-- table already there.

alter table expense_attachments add column if not exists file_name text;
alter table expense_attachments add column if not exists file_url text;
alter table expense_attachments add column if not exists file_size int
  check (file_size is null or file_size >= 0);
alter table expense_attachments add column if not exists mime_type text;
alter table expense_attachments add column if not exists created_by uuid
  references auth.users (id) on delete set null;

-- Carry any row written under the old shape across. `url` was `not null`, so
-- every existing row has one.
update expense_attachments
   set file_url  = coalesce(file_url, url),
       file_name = coalesce(file_name, regexp_replace(url, '^.*/', ''))
 where file_url is null or file_name is null;

-- `url` is kept, but nothing writes it any more: dropping it would throw away
-- the only copy of anything this migration failed to carry over. It has to
-- stop being required for an insert to succeed.
alter table expense_attachments alter column url drop not null;

-- A row has to point at something. Either column satisfies it, so old rows
-- stay valid and new ones need only file_url.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expense_attachments_has_target') then
    alter table expense_attachments add constraint expense_attachments_has_target
      check (file_url is not null or url is not null);
  end if;
end $$;

create index if not exists expense_attachments_personal_idx
  on expense_attachments (company_id, personal_expense_id)
  where personal_expense_id is not null;
create index if not exists expense_attachments_company_expense_idx
  on expense_attachments (company_id, expense_id)
  where expense_id is not null;
