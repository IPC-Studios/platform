-- Lovable parity: data record extended fields.
-- Additive only: IF NOT EXISTS guards.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='team_member_name') then
    alter table shoot_data_records add column team_member_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='requirement_name') then
    alter table shoot_data_records add column requirement_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='date_received') then
    alter table shoot_data_records add column date_received date;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='received_by_name') then
    alter table shoot_data_records add column received_by_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='notes') then
    alter table shoot_data_records add column notes text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='data_status') then
    alter table shoot_data_records add column data_status text not null default 'pending'
      check (data_status in ('pending','copied','verified','issue_found','not_required'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='issue_found') then
    alter table shoot_data_records add column issue_found boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='is_not_required') then
    alter table shoot_data_records add column is_not_required boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='shoot_data_records' and column_name='backup_granularity') then
    alter table shoot_data_records add column backup_granularity text;
  end if;
end $$;
