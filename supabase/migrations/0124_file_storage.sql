-- File storage. The rebuild had no storage layer at all, so every "upload" in
-- the UI was either a pasted URL or — worse — a stub that wrote `upload://name`
-- into the company's logo field, which then rendered as a broken image on every
-- invoice, quotation and public page.
--
-- Files live in Postgres as bytea rather than an object store: the whole
-- deployment is one VPS with one database and a nightly pg_dump, so a bucket
-- would add a second thing to back up, restore and keep credentials for. The
-- 10 MB per-file cap is enforced in the API and again here, which keeps the
-- table small enough that TOAST handles it without tuning.
--
-- `is_public` is the whole access model: a logo has to load in a client's
-- browser with no session, an expense bill must not.

create table if not exists files (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  mime        text not null check (char_length(mime) between 3 and 100),
  size_bytes  int not null check (size_bytes > 0 and size_bytes <= 10485760),
  bytes       bytea not null,
  -- Served without a session. Only ever set for branding assets.
  is_public   boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists files_company_idx on files (company_id, created_at desc);

alter table files enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'files_select') then
    create policy files_select on files for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'files_write') then
    create policy files_write on files for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;

-- Metadata without the payload. Listing attachments should not drag every
-- byte of every bill through the connection just to show file names.
create or replace function list_files(p_ids uuid[])
returns table (id uuid, name text, mime text, size_bytes int, is_public boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.mime, f.size_bytes, f.is_public, f.created_at
    from files f
   where f.company_id = get_current_company_id()
     and f.id = any (p_ids)
   order by f.created_at desc;
$$;
revoke all on function list_files(uuid[]) from public, anon;
grant execute on function list_files(uuid[]) to authenticated;

-- Undo the stub's damage: `upload://whatever.png` is not a URL any browser can
-- fetch, so these fields are worse than empty — they render as a broken image
-- on client-facing documents. Clear them so the field reads as "not set".
update companies set avatar_url = null where avatar_url like 'upload://%';
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'companies' and column_name = 'invoice_logo_url') then
    update companies set invoice_logo_url = null where invoice_logo_url like 'upload://%';
  end if;
end $$;
