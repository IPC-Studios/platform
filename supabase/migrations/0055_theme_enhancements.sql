-- Theme customization enhancements: custom color, border radius, and font picker.
-- Extend the existing company_theme_settings table.
alter table company_theme_settings
  add column if not exists custom_color text,
  add column if not exists border_radius text default '0.5'
    check (border_radius in ('0', '0.25', '0.5', '0.75', '1')),
  add column if not exists font_key text default 'inter'
    check (font_key in ('inter', 'system', 'serif', 'mono', 'poppins', 'roboto'));

-- Theme presets with more options
create table if not exists theme_presets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  name          text not null,
  preset_key    text not null,
  custom_color  text,
  border_radius text,
  font_key      text,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index theme_presets_company_idx on theme_presets (company_id);

alter table theme_presets enable row level security;
create policy theme_presets_select on theme_presets for select to authenticated
  using (company_id = get_current_company_id());
create policy theme_presets_write on theme_presets for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());
create unique index if not exists theme_presets_company_key_uidx on theme_presets (company_id, preset_key);
