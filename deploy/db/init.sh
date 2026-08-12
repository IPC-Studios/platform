#!/bin/bash
# Runs ONCE on the db container's first boot (docker-entrypoint-initdb.d), as the
# Postgres superuser over the local socket. Applies the bootstrap, sets the
# authenticator password, then every migration in order. On an existing volume
# this does NOT re-run — for schema upgrades, apply new migrations manually or
# recreate the volume.
set -euo pipefail

run() { psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"; }

echo "[init] bootstrap (roles, auth schema, extensions)"
run -f /db/00_bootstrap.sql

echo "[init] set authenticator login password"
run -c "alter role authenticator with login password '${DB_AUTHENTICATOR_PASSWORD}'"

echo "[init] applying migrations"
# Skip 0000_init_extensions (Supabase-specific; the bootstrap installs extensions
# into public instead). sort => 0001, 0002, ... 0020 in order.
for f in $(ls /db/migrations/*.sql | grep -v '/0000_' | sort); do
  echo "[init]   $(basename "$f")"
  run -f "$f"
done

echo "[init] done"
