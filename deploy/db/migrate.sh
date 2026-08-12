#!/bin/sh
# Idempotent DB migrator — runs on every deploy (the `migrate` compose service).
# 1. applies the bootstrap (roles/auth/extensions/grants), which is idempotent
# 2. records applied migrations in a schema_migrations ledger and runs only the
#    ones not yet applied, each in its own transaction
#
# Adopting an EXISTING database (already migrated 0001.. by hand / old init.sh):
# if the ledger is empty but the schema already exists (companies table present),
# every current migration is BASELINED (marked applied without re-running), so
# only genuinely new files run from then on.
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -v ON_ERROR_STOP=1 -h ${PGHOST:-db} -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-ipc}"

echo "[migrate] bootstrap (idempotent)"
$PSQL -f /db/00_bootstrap.sql
$PSQL -c "alter role authenticator with login password '${DB_AUTHENTICATOR_PASSWORD}'"

echo "[migrate] ensure ledger"
$PSQL -c "create table if not exists schema_migrations (
  filename text primary key, applied_at timestamptz not null default now());"

# Baseline decision made once, before the loop.
HAS_SCHEMA=$($PSQL -tAc "select to_regclass('public.companies') is not null")
LEDGER_COUNT=$($PSQL -tAc "select count(*) from schema_migrations")

for f in $(ls /db/migrations/*.sql | grep -v '/0000_' | sort); do
  name=$(basename "$f")
  applied=$($PSQL -tAc "select 1 from schema_migrations where filename = '$name'")
  [ "$applied" = "1" ] && continue

  if [ "$HAS_SCHEMA" = "t" ] && [ "$LEDGER_COUNT" = "0" ]; then
    echo "[migrate] baseline (mark applied, do not run) $name"
    $PSQL -c "insert into schema_migrations (filename) values ('$name')"
  else
    echo "[migrate] applying $name"
    $PSQL -1 -f "$f"
    $PSQL -c "insert into schema_migrations (filename) values ('$name')"
  fi
done

echo "[migrate] done"
