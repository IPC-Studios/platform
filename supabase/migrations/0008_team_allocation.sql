-- Phase 6: team allocation. team_assignment_slots book a member into a time
-- range for a shoot/service. Double-booking is impossible:
--   * a portable BEFORE-INSERT/UPDATE trigger rejects overlaps (works anywhere,
--     incl. pglite), and
--   * where btree_gist is available (real Supabase), a GiST EXCLUDE constraint
--     also enforces it atomically under concurrency (closes the race the
--     original had).
-- Back-to-back (end == next start) is allowed via the half-open range '[)'.

create table team_assignment_slots (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies (id) on delete cascade,
  user_id                  uuid not null references users (user_id) on delete cascade,
  shoot_id                 uuid references shoots (id) on delete set null,
  service_name             text,
  start_at                 timestamptz not null,
  end_at                   timestamptz not null,
  status                   text not null default 'booked'
                            check (status in ('booked', 'released', 'cancelled')),
  estimated_cost           numeric(12, 2),
  final_cost               numeric(12, 2),
  cost_status              text not null default 'not_decided',
  data_required            boolean not null default false,
  data_not_required_reason text,
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default now(),
  check (end_at > start_at)
);
create index tas_company_user_idx on team_assignment_slots (company_id, user_id);
create index tas_shoot_idx on team_assignment_slots (shoot_id);

-- Portable overlap guard (BEFORE INSERT/UPDATE).
create or replace function team_slot_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'booked' and exists (
    select 1 from team_assignment_slots s
    where s.user_id = new.user_id
      and s.status = 'booked'
      and s.id <> new.id
      and s.start_at < new.end_at
      and new.start_at < s.end_at
  ) then
    raise exception 'double_booking: member already booked in this window'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;
create trigger team_slot_no_overlap_trg
  before insert or update on team_assignment_slots
  for each row execute function team_slot_no_overlap();

-- Atomic concurrency guard where the extension exists (prod). No-op on pglite.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'btree_gist') then
    create extension if not exists btree_gist;
    execute $q$
      alter table team_assignment_slots
        add constraint team_slot_no_double_booking
        exclude using gist (
          user_id with =,
          tstzrange(start_at, end_at, '[)') with &&
        ) where (status = 'booked')
    $q$;
  end if;
end $$;

alter table team_assignment_slots enable row level security;
create policy tas_select on team_assignment_slots
  for select to authenticated using (company_id = get_current_company_id());
create policy tas_write on team_assignment_slots
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

-- ── RPCs ──────────────────────────────────────────────────────
create or replace function book_team_slot(
  p_user_id       uuid,
  p_shoot_id      uuid,
  p_service_name  text,
  p_start_at      timestamptz,
  p_end_at        timestamptz,
  p_estimated_cost numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_slot    uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into team_assignment_slots
    (company_id, user_id, shoot_id, service_name, start_at, end_at, estimated_cost, created_by)
    values (v_company, p_user_id, p_shoot_id, p_service_name, p_start_at, p_end_at, p_estimated_cost, auth.uid())
    returning id into v_slot;
  return v_slot;
end;
$$;

create or replace function set_team_slot_status(p_slot_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('booked', 'released', 'cancelled') then
    raise exception 'invalid status';
  end if;
  update team_assignment_slots
    set status = p_status
    where id = p_slot_id and company_id = get_current_company_id();
end;
$$;

revoke all on function book_team_slot(uuid, uuid, text, timestamptz, timestamptz, numeric) from public, anon;
revoke all on function set_team_slot_status(uuid, text) from public, anon;
grant execute on function book_team_slot(uuid, uuid, text, timestamptz, timestamptz, numeric) to authenticated;
grant execute on function set_team_slot_status(uuid, text) to authenticated;
