#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${NODE_ENV:-}" == "production" || "${ALLOW_DEVELOPMENT_SEED:-}" != "yes" ]]; then
  echo "Development seed refused. Set ALLOW_DEVELOPMENT_SEED=yes outside production." >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi
(cd "$PROJECT_DIR" && node server/seed.js)
