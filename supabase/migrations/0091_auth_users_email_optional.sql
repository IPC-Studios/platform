-- 0026_team_directory.sql added an offline/no-login team member and said, in
-- its own comment, that this was safe because "auth.users.email is already
-- nullable" -- it was not. The bootstrap schema has always declared it
-- `text unique not null`, so every attempt to add a team member without an
-- email (the entire point of the "No, offline team member" step in the add-
-- member wizard) has been failing the insert with a not-null violation,
-- surfaced to the owner only as the generic "We could not add this member."
--
-- A null email does not collide with the unique constraint: two rows with a
-- null email are not considered equal for uniqueness purposes, so dropping
-- not null here is the only change needed.
alter table auth.users
  alter column email drop not null;
