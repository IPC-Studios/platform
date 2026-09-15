-- Lovable parity: storage location extended fields. Additive only.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='storage_locations' and column_name='location_type') then
    alter table storage_locations add column location_type text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='storage_locations' and column_name='capacity_gb') then
    alter table storage_locations add column capacity_gb numeric(12,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_name='storage_locations' and column_name='owner') then
    alter table storage_locations add column owner text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='storage_locations' and column_name='notes') then
    alter table storage_locations add column notes text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='storage_locations' and column_name='is_active') then
    alter table storage_locations add column is_active boolean not null default true;
  end if;
end $$;
