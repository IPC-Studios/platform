-- Theme & branding, phase 2: named themes and a typeface per studio.
--
-- The five colour-only presets become nine named themes, each shipping a
-- matching font. Existing rows carry the old keys, so they are mapped here
-- rather than left to fall back to the default — a studio that picked Rose
-- should still open on a rose palette after this deploys.
--
-- font_key is nullable and means "whatever the preset ships with". Only an
-- explicit choice from the font picker writes a value, so re-themeing keeps
-- following the theme's own face until someone overrides it.

alter table company_theme_settings
  add column if not exists font_key text;

update company_theme_settings
   set preset_key = case preset_key
     when 'brand'   then 'ipc_classic'
     when 'indigo'  then 'royal_purple'
     when 'emerald' then 'emerald_studio'
     when 'amber'   then 'luxury_gold'
     when 'rose'    then 'blush_wedding'
     else preset_key
   end
 where preset_key in ('brand', 'indigo', 'emerald', 'amber', 'rose');

alter table company_theme_settings
  alter column preset_key set default 'ipc_classic';
