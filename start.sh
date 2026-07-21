#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-4001}"
JWT_SECRET_VALUE="${JWT_SECRET:-}"

if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
  echo "Dependencies are absent. Run ./scripts/bootstrap.sh explicitly." >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" && ( -z "${DB_HOST:-}" || -z "${DB_NAME:-}" || -z "${DB_USER:-}" || -z "${DB_PASSWORD:-}" ) ]]; then
  echo "Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD." >&2
  exit 1
fi
if [[ "${#JWT_SECRET_VALUE}" -lt 32 ]]; then
  echo "JWT_SECRET must contain at least 32 characters." >&2
  exit 1
fi
if lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $BACKEND_PORT is occupied; no process was terminated." >&2
  exit 1
fi
cd "$PROJECT_DIR"
exec npm run server
