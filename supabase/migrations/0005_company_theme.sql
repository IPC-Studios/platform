-- Phase 3: per-tenant theme settings. One row per company. The preset key and
-- scheme are validated against an allow-list on the server before write (the
-- same list the client's ThemeProvider ships). Custom hex is intentionally NOT
-- accepted — companies pick from named presets only.

create table company_theme_settings (
  company_id       uuid primary key references companies (id) on delete cascade,
  is_custom_theme  boolean not null default false,
  preset_key       text not null default 'indigo',
  color_scheme     text not null default 'light' check (color_scheme in ('light', 'dark', 'system')),
  logo_url         text,
  updated_at       timestamptz not null default now()
);
create trigger cts_set_updated_at before update on company_theme_settings
  for each row execute function set_updated_at();

alter table company_theme_settings enable row level security;

-- Any member reads their studio's theme; only the owner changes it.
create policy cts_select on company_theme_settings
  for select to authenticated
  using (company_id = get_current_company_id());

create policy cts_write_owner on company_theme_settings
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_owner())
  with check (company_id = get_current_company_id() and is_current_owner());
