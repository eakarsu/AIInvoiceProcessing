#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
npm --prefix "$PROJECT_DIR" ci
echo "Lockfile dependencies installed; database and seed state were not changed."
