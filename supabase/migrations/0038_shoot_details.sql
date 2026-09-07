-- Shoot detail: where it is, what it needs, and the shapes a studio repeats.
--
-- The shoots table already carried a date, a time window and a location, and
-- shoot_services has held "which service, how many" since 0006 — correctly
-- policied, never reachable: no contract, no endpoint, no UI. What was
-- genuinely missing is the pin on the map and somewhere to keep a preset.

-- A location field holds "Taj Lands End, Mumbai". It does not hold the link
-- the driver actually needs, and pasting one into it wrecks the address text
-- on every list that prints it.
alter table shoots
  add column if not exists map_link text;

-- ── presets ───────────────────────────────────────────────────
-- A studio shoots the same three days all season. A preset is that shape,
-- saved: 'shoot' keeps a whole day (requirements and internal work), while
-- 'internal_work' keeps just the list of edit-room items. The payload is
-- jsonb because it is a template the UI writes and reads, never a thing the
-- API queries into.
create table if not exists shoot_presets (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  kind       text not null check (kind in ('shoot', 'internal_work')),
  name       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Saving under a name that exists overwrites it; that is what "save preset"
  -- means to the person pressing it, and it keeps the list from filling up
  -- with "Wedding day", "Wedding day (2)".
  unique (company_id, kind, name)
);
create index if not exists shoot_presets_company_kind_idx
  on shoot_presets (company_id, kind, name);

alter table shoot_presets enable row level security;

create policy shoot_presets_select on shoot_presets for select to authenticated
  using (company_id = get_current_company_id());
create policy shoot_presets_write on shoot_presets for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
