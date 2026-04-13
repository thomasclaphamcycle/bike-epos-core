#!/usr/bin/env bash
set -euo pipefail

resolve_pg_dump() {
  if command -v pg_dump >/dev/null 2>&1; then
    command -v pg_dump
    return 0
  fi

  local candidate=""
  for candidate in \
    /opt/homebrew/bin/pg_dump \
    /opt/homebrew/opt/libpq/bin/pg_dump \
    /usr/local/bin/pg_dump \
    /usr/local/opt/libpq/bin/pg_dump; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if ! PG_DUMP_BIN="$(resolve_pg_dump)"; then
  echo "pg_dump is required but was not found on PATH or common local install paths." >&2
  exit 1
fi

if [[ $# -gt 1 ]]; then
  echo "Usage: scripts/backup_database.sh [output-file]" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set before running scripts/backup_database.sh." >&2
  exit 1
fi

timestamp="$(date +"%Y%m%d_%H%M%S")"
default_output="backups/corepos_${timestamp}.dump"
output_path="${1:-$default_output}"

mkdir -p "$(dirname "$output_path")"

"$PG_DUMP_BIN" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$output_path" \
  "$DATABASE_URL"

repo_root=""
if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  repo_root="$git_root"
fi

if [[ -n "$repo_root" ]]; then
  state_dir="${COREPOS_RELEASE_STATE_DIR:-$repo_root/.corepos-runtime}"
  backup_metadata_path="${COREPOS_LAST_BACKUP_PATH:-$state_dir/last-backup.json}"
  mkdir -p "$state_dir"

  absolute_output_path="$(node -p "require('path').resolve(process.argv[1])" "$output_path")"
  current_commit="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo unknown)"

  BACKUP_METADATA_PATH="$backup_metadata_path" \
  BACKUP_OUTPUT_PATH="$absolute_output_path" \
  BACKUP_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  BACKUP_COMMIT="$current_commit" \
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const metadataPath = process.env.BACKUP_METADATA_PATH;
const payload = {
  timestamp: process.env.BACKUP_TIMESTAMP,
  path: process.env.BACKUP_OUTPUT_PATH,
  commit: process.env.BACKUP_COMMIT,
};

fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`);
NODE
fi

echo "CorePOS backup written to $output_path"
