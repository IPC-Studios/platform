-- Full custom-theme colours: the old app let a studio type 8 independent
-- hex values (primary, secondary, accent, background, surface, text, muted
-- text, border) plus a corner-radius shape, saved as its own "custom" theme
-- alongside the named presets. This app only ever grew as far as one
-- `custom_color` override (0055) that nothing even re-applies on page load
-- (only the settings page's own onChange/onBlur handlers touch the CSS
-- variable, so the saved value never survives a reload) -- this migration
-- gives every token its own column; the web layer (ThemeProvider) is what
-- actually makes them stick.
alter table company_theme_settings
  add column if not exists primary_color    text,
  add column if not exists secondary_color  text,
  add column if not exists accent_color     text,
  add column if not exists background_color text,
  add column if not exists surface_color    text,
  add column if not exists text_color       text,
  add column if not exists muted_text_color text,
  add column if not exists border_color     text;

-- Whatever a studio already saved through the single custom_color field
-- becomes its Primary override, so this migration doesn't quietly reset
-- anyone who already turned it on.
update company_theme_settings
  set primary_color = custom_color
  where primary_color is null and custom_color is not null;
