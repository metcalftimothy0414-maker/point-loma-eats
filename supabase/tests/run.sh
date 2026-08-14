#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres instance, then runs
# the numbered test files in this directory against it. Requires a local
# `postgres`/`initdb`/`psql` (e.g. `brew install postgresql`) — real
# pg_cron/pg_net/Supabase Realtime aren't installable outside an actual
# Supabase instance, so 00_stub.sql stubs just enough of their surface
# (schemas/functions/publication) for the migrations that reference them to
# apply cleanly; their actual scheduling/broadcast behavior isn't exercised
# here, only the SQL that runs on top of them.
#
# Run from the repo root: supabase/tests/run.sh

set -euo pipefail

MIGRATIONS_DIR="supabase/migrations"
TESTS_DIR="supabase/tests"
PORT=5544
PGDATA_DIR="$(mktemp -d)"
DB_NAME=plmtest

cleanup() {
  pg_ctl -D "$PGDATA_DIR" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR"
}
trap cleanup EXIT

echo "==> starting throwaway Postgres in $PGDATA_DIR"
initdb -D "$PGDATA_DIR" -U postgres -A trust -E UTF8 >/dev/null
pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -k /tmp" -l "$PGDATA_DIR/log.txt" start >/dev/null
createdb -h /tmp -p "$PORT" -U postgres "$DB_NAME"

PSQL=(psql -h /tmp -p "$PORT" -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q)

echo "==> applying stub + migrations"
"${PSQL[@]}" -f "$TESTS_DIR/00_stub.sql"
for migration in "$MIGRATIONS_DIR"/*.sql; do
  # 0005 does `create extension pg_cron`/`pg_net` itself, not just call
  # net.http_post() the way 0008 does — those extensions genuinely aren't
  # installable outside a real Supabase instance, so there's no stub that
  # makes `create extension` succeed short of faking the extension system
  # itself. Every other migration applies for real; this is the one
  # documented gap, not a silent skip.
  if [[ "$(basename "$migration")" == 0005_* ]]; then
    echo "    (skipping $(basename "$migration") — needs real pg_cron/pg_net, not installable locally)"
    continue
  fi
  "${PSQL[@]}" -f "$migration"
done

echo "==> running tests"
for test_file in "$TESTS_DIR"/0[1-9]_*.sql; do
  echo "--- $test_file ---"
  "${PSQL[@]}" -f "$test_file"
done

echo "==> all tests passed"
