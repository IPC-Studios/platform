-- Phase 7: data custody. Track each shoot's footage card -> primary copy ->
-- backup copy, with full attribution (who copied it, to which location, verified
-- when). storage_locations + data_people are the referenceable catalogues.

create table storage_locations (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  kind       text not null default 'drive' check (kind in ('drive', 'nas', 'cloud', 'other')),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- People who handle data but may not be app users (interns, external copiers).
create table data_people (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table shoot_data_records (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies (id) on delete cascade,
  project_id          uuid references projects (id) on delete cascade,
  shoot_id            uuid references shoots (id) on delete cascade,
  data_type           text,
  data_label          text not null,
  -- Two independent custody tracks: primary copy and backup copy.
  primary_status      text not null default 'pending'
                        check (primary_status in ('pending', 'copied', 'verified')),
  backup_status       text not null default 'pending'
                        check (backup_status in ('pending', 'copied', 'verified')),
  primary_location_id uuid references storage_locations (id) on delete set null,
  backup_location_id  uuid references storage_locations (id) on delete set null,
  folder_path         text,
  backup_folder_path  text,
  cloud_link          text,
  backup_cloud_link   text,
  card_count          int not null default 0,
  file_count          int not null default 0,
  size_gb             numeric(10, 2) not null default 0,
  copied_by_uid       uuid references auth.users (id),
  copied_by_person_id uuid references data_people (id),
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index sdr_company_shoot_idx on shoot_data_records (company_id, shoot_id);
create index sdr_project_idx on shoot_data_records (project_id);
create trigger sdr_set_updated_at before update on shoot_data_records
  for each row execute function set_updated_at();

alter table storage_locations   enable row level security;
alter table data_people         enable row level security;
alter table shoot_data_records  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['storage_locations','data_people','shoot_data_records']
  loop
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = get_current_company_id());', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = get_current_company_id() and is_current_user_active())
         with check (company_id = get_current_company_id() and is_current_user_active());', t, t);
  end loop;
end $$;

-- Mark a track verified in one step (stamps verified_at when both are verified).
create or replace function verify_data_record(p_record_id uuid, p_track text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_track = 'primary' then
    update shoot_data_records set primary_status = 'verified'
      where id = p_record_id and company_id = get_current_company_id();
  elsif p_track = 'backup' then
    update shoot_data_records set backup_status = 'verified'
      where id = p_record_id and company_id = get_current_company_id();
  else
    raise exception 'invalid track';
  end if;

  update shoot_data_records set verified_at = now()
    where id = p_record_id and verified_at is null
      and primary_status = 'verified' and backup_status = 'verified';
end;
$$;

revoke all on function verify_data_record(uuid, text) from public, anon;
grant execute on function verify_data_record(uuid, text) to authenticated;
