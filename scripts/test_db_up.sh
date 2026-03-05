#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env.test" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.test"
  set +a
fi

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "TEST_DATABASE_URL is required. Copy .env.test.example to .env.test and update values."
  exit 1
fi

echo "[test-db] Starting Postgres test container..."
docker compose -f docker-compose.test.yml up -d db_test

echo "[test-db] Waiting for Postgres readiness..."
for _ in $(seq 1 60); do
  if docker compose -f docker-compose.test.yml exec -T db_test \
    pg_isready -U bike_epos_test -d bike_epos_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[test-db] Running Prisma migrations (migrate deploy for deterministic, non-interactive test setup)..."
DATABASE_URL="${TEST_DATABASE_URL}" npx prisma migrate deploy

echo "[test-db] Generating Prisma client..."
DATABASE_URL="${TEST_DATABASE_URL}" npx prisma generate

echo "[test-db] Test database is ready."
