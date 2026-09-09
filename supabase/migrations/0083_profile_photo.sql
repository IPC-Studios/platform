-- The original let a person put a photo URL on their own profile, next to
-- the studio's own logo URL (companies.avatar_url, already here) -- a plain
-- link, not an upload, same as the studio logo.
alter table users add column if not exists avatar_url text;
