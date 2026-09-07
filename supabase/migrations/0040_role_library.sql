-- Job roles: which part of the job they belong to, and a catalogue to start from.
--
-- A studio types the same two dozen roles every other studio types —
-- "Candid Photographer", "Same Day Video Editor", "Album Designer". Making
-- each one invent that list from an empty screen is the reason the roles page
-- sits empty in most accounts.

-- Which part of the job a role belongs to. Nullable on purpose: rows that
-- predate this column are read by name (the UI derives a stage from keywords),
-- and an explicit value simply wins over the guess.
alter table employee_roles
  add column if not exists stage text
    check (stage is null or stage in ('pre', 'production', 'post', 'other'));

-- ── the catalogue ─────────────────────────────────────────────
-- Platform-owned and read-only to tenants: every studio sees the same list and
-- copies from it into employee_roles. Copying rather than referencing is the
-- point — a studio renames "Drone Operator" to "Drone Pilot" because that is
-- what they call it, and that must not rename it for anyone else.
create table if not exists role_library (
  id         uuid primary key default gen_random_uuid(),
  type_name  text not null unique,
  role_code  text not null unique,
  stage      text not null check (stage in ('pre', 'production', 'post', 'other')),
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists role_library_stage_idx on role_library (stage, sort_order);

alter table role_library enable row level security;

-- Readable by every signed-in member; there is nothing tenant-specific in it.
-- No write policy: the catalogue changes by migration, not by a customer.
-- Dropped first so the file can be re-run by hand against a live database
-- without tripping over its own policy.
drop policy if exists role_library_select on role_library;
create policy role_library_select on role_library for select to authenticated
  using (true);

insert into role_library (type_name, role_code, stage, sort_order) values
  ('Sales',                   'sales',                   'pre',        10),
  ('Sales Executive',         'sales_executive',         'pre',        20),
  ('Client Coordinator',      'client_coordinator',      'pre',        30),
  ('Pre-Production Planner',  'pre_production_planner',  'pre',        40),
  ('Creative Director',       'creative_director',       'pre',        50),
  ('Traditional Photographer','traditional_photographer','production', 10),
  ('Traditional Videographer','traditional_videographer','production', 20),
  ('Candid Photographer',     'candid_photographer',     'production', 30),
  ('Cinematographer',         'cinematographer',         'production', 40),
  ('Drone Operator',          'drone_operator',          'production', 50),
  ('Lighting Technician',     'lighting_technician',     'production', 60),
  ('Assistant Photographer',  'assistant_photographer',  'production', 70),
  ('BTS Shooter',             'bts_shooter',             'production', 80),
  ('Mobile Cinematographer',  'mobile_cinematographer',  'production', 90),
  ('Same Day Video Editor',   'same_day_video_editor',   'post',       10),
  ('Video Editor',            'video_editor',            'post',       20),
  ('Cinematic Video Editor',  'cinematic_video_editor',  'post',       30),
  ('Photo Editor',            'photo_editor',            'post',       40),
  ('Image Editor',            'image_editor',            'post',       50),
  ('Album Designer',          'album_designer',          'post',       60),
  ('Data Manager',            'data_manager',            'post',       70),
  ('Operations Manager',      'operations_manager',      'other',      10),
  ('Manager',                 'manager',                 'other',      20)
on conflict (type_name) do nothing;
