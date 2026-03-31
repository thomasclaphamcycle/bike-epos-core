#!/usr/bin/env bash
set -euo pipefail

echo "WARNING: scripts/db_restore.sh is the legacy plain-SQL restore helper." >&2
echo "For backups created by scripts/backup_database.sh, use scripts/restore_database.sh or npm run db:restore." >&2

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required."
  exit 1
fi

looks_like_production() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == *"prod"* ]] || \
  [[ "$value" == *"production"* ]] || \
  [[ "$value" == *"rds.amazonaws.com"* ]] || \
  [[ "$value" == *"supabase"* ]] || \
  [[ "$value" == *"render.com"* ]] || \
  [[ "$value" == *"railway.app"* ]] || \
  [[ "$value" == *"neon.tech"* ]]
}

if looks_like_production "$DATABASE_URL" && [[ "${CONFIRM_PROD:-false}" != "true" ]]; then
  echo "Refusing restore: DATABASE_URL appears to target production."
  echo "Set CONFIRM_PROD=true to override intentionally."
  exit 1
fi

backup_file="${BACKUP_FILE:-${1:-}}"
if [[ -z "$backup_file" ]]; then
  echo "Provide backup path via BACKUP_FILE env var or first script argument."
  exit 1
fi

if [[ ! -f "$backup_file" ]]; then
  echo "Backup file not found: $backup_file"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not found in PATH."
  exit 1
fi

echo "WARNING: restore is destructive and will overwrite target database state."
echo "Restoring from $backup_file ..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$backup_file"
echo "Restore completed for target DATABASE_URL."
