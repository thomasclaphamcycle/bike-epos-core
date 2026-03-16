#!/usr/bin/env bash
set -euo pipefail

resolve_pg_restore() {
  if command -v pg_restore >/dev/null 2>&1; then
    command -v pg_restore
    return 0
  fi

  local candidate=""
  for candidate in \
    /opt/homebrew/bin/pg_restore \
    /opt/homebrew/opt/libpq/bin/pg_restore \
    /usr/local/bin/pg_restore \
    /usr/local/opt/libpq/bin/pg_restore; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if ! PG_RESTORE_BIN="$(resolve_pg_restore)"; then
  echo "pg_restore is required but was not found on PATH or common local install paths." >&2
  exit 1
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/restore_database.sh <dump-file>" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set before running scripts/restore_database.sh." >&2
  exit 1
fi

dump_file="$1"
if [[ ! -f "$dump_file" ]]; then
  echo "Dump file not found: $dump_file" >&2
  exit 1
fi

if [[ "${COREPOS_CONFIRM_RESTORE:-0}" != "1" ]]; then
  echo "Restore is destructive. Re-run with COREPOS_CONFIRM_RESTORE=1 to continue." >&2
  exit 1
fi

"$PG_RESTORE_BIN" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$DATABASE_URL" \
  "$dump_file"

echo "CorePOS restore completed from $dump_file"
