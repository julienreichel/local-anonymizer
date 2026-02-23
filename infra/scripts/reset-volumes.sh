#!/usr/bin/env sh
# reset-volumes.sh – clears processed uploads and SQLite DB for a fresh start.
# Usage: ./infra/scripts/reset-volumes.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Clearing uploads..."
find "$REPO_ROOT/infra/volumes/uploads" -type f ! -name '.gitkeep' -delete

echo "Clearing data..."
find "$REPO_ROOT/infra/volumes/data" -type f ! -name '.gitkeep' -delete

echo "Done. Run 'docker compose up --build' to start fresh."
