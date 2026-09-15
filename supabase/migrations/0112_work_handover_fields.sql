-- Lovable parity: hard-disk handover fields on work submissions. Additive only.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='team_work_submissions' and column_name='disk_name') then
    alter table team_work_submissions add column disk_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='team_work_submissions' and column_name='disk_location') then
    alter table team_work_submissions add column disk_location text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='team_work_submissions' and column_name='folder_path') then
    alter table team_work_submissions add column folder_path text;
  end if;
end $$;
