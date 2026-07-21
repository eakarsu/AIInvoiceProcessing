#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
disposable_test=false
if [[ "${NODE_ENV:-}" == "test" && "${ALLOW_SCHEMA_MIGRATION:-}" == "1" && "${ALLOW_DESTRUCTIVE_SEED:-}" == "true" ]]; then
  disposable_test=true
fi
if [[ "${ALLOW_SCHEMA_MUTATION:-}" != "yes" && "$disposable_test" != "true" ]]; then
  echo "Refusing schema changes. Back up/review, then set ALLOW_SCHEMA_MUTATION=yes (or use the guarded disposable-test path)." >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi
if [[ "$disposable_test" == "true" ]]; then
  users_table="$(psql -At "$DATABASE_URL" -c "SELECT to_regclass('public.users') IS NOT NULL")"
  if [[ "$users_table" != "t" ]]; then
    psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$PROJECT_DIR/server/schema.sql"
  fi
fi
for migration in "$PROJECT_DIR"/server/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$migration"
done
