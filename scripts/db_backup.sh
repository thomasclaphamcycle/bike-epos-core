#!/usr/bin/env bash
set -euo pipefail

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
  echo "Refusing backup: DATABASE_URL appears to target production."
  echo "Set CONFIRM_PROD=true to override intentionally."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not found in PATH."
  exit 1
fi

mkdir -p backups
timestamp="$(date +%Y%m%d_%H%M%S)"
output_file="backups/backup_${timestamp}.sql"

echo "Creating backup..."
pg_dump --clean --if-exists --no-owner --no-privileges "$DATABASE_URL" > "$output_file"
echo "Backup created: $output_file"
