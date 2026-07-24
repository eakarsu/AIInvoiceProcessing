#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "Create .env from .env.example first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. "$PROJECT_DIR/.env"
set +a

BACKEND_PORT="${BACKEND_PORT:-4001}"
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
JWT_SECRET_VALUE="${JWT_SECRET:-}"
export BACKEND_PORT FRONTEND_PORT

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
for assigned_port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -nP -iTCP:"$assigned_port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $assigned_port is occupied; no process was terminated." >&2
    exit 1
  fi
done

cleanup() {
  kill "${backend_pid:-}" "${frontend_pid:-}" 2>/dev/null || true
  wait "${backend_pid:-}" "${frontend_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"
npm run server &
backend_pid=$!
node server/frontend.js &
frontend_pid=$!
echo "Backend child $backend_pid; frontend child $frontend_pid."
wait "$backend_pid" "$frontend_pid"
