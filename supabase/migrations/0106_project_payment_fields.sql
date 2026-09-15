-- Lovable parity: project payment fields (status/description/GST).
-- Additive only: new nullable columns with safe defaults.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='received_payments' and column_name='status') then
    alter table received_payments add column status text not null default 'paid'
      check (status in ('paid','pending'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name='received_payments' and column_name='description') then
    alter table received_payments add column description text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='received_payments' and column_name='is_gst') then
    alter table received_payments add column is_gst boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='received_payments' and column_name='gst_number') then
    alter table received_payments add column gst_number text;
  end if;
end $$;
