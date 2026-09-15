-- Per-lane colour on the production board.
--
-- Keyed the same way as production_board_card_order (company + board_view +
-- lane_key) so the two sets of board preferences stay consistent, and so a
-- studio that later runs more than one board view gets per-view colours for
-- free rather than one global palette.
--
-- The colour is a token name, not a hex value: the board has to stay legible
-- in both light and dark, and a hex picked against a white panel will not.
-- Widening the vocabulary later is a check-constraint change, not a data
-- migration.

create table if not exists board_lane_prefs (
  company_id uuid not null references companies (id) on delete cascade,
  board_view text not null default 'default',
  lane_key   text not null,
  color      text not null check (color in (
    'default', 'slate', 'blue', 'green', 'amber', 'rose', 'violet'
  )),
  updated_at timestamptz not null default now(),
  primary key (company_id, board_view, lane_key)
);

alter table board_lane_prefs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'board_lane_prefs_select') then
    create policy board_lane_prefs_select on board_lane_prefs for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'board_lane_prefs_write') then
    create policy board_lane_prefs_write on board_lane_prefs for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;
end $$;
