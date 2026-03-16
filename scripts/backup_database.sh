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

echo "CorePOS backup written to $output_path"
