#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF' >&2
Usage: scripts/upgrade_corepos.sh

Required environment:
  DATABASE_URL               PostgreSQL connection string for the target database

Restart configuration (choose one):
  COREPOS_RESTART_CMD        Shell command used to restart CorePOS safely
  COREPOS_SYSTEMD_SERVICE    systemd service name to restart via systemctl

Optional:
  COREPOS_HEALTHCHECK_URL    URL to poll after restart (for example http://127.0.0.1:3000/health)
EOF
}

log_step() {
  printf '\n[%s] %s\n' "corepos-upgrade" "$1"
}

require_restart_configuration() {
  if [[ -n "${COREPOS_RESTART_CMD:-}" ]] || [[ -n "${COREPOS_SYSTEMD_SERVICE:-}" ]]; then
    return 0
  fi

  echo "Set COREPOS_RESTART_CMD or COREPOS_SYSTEMD_SERVICE before running the upgrade." >&2
  usage
  exit 1
}

wait_for_healthcheck() {
  local url="$1"
  local attempt=0

  while (( attempt < 30 )); do
    if curl --silent --show-error --fail "$url" >/dev/null; then
      log_step "Health check passed at $url"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  echo "Health check failed after restart: $url" >&2
  exit 1
}

restart_application() {
  if [[ -n "${COREPOS_RESTART_CMD:-}" ]]; then
    log_step "Restarting application via COREPOS_RESTART_CMD"
    bash -lc "$COREPOS_RESTART_CMD"
  else
    log_step "Restarting systemd service ${COREPOS_SYSTEMD_SERVICE}"
    systemctl restart "$COREPOS_SYSTEMD_SERVICE"
  fi

  if [[ -n "${COREPOS_HEALTHCHECK_URL:-}" ]]; then
    wait_for_healthcheck "$COREPOS_HEALTHCHECK_URL"
  fi
}

if [[ $# -ne 0 ]]; then
  usage
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set before running scripts/upgrade_corepos.sh." >&2
  usage
  exit 1
fi

require_restart_configuration

cd "$REPO_ROOT"

log_step "Checking repository state"
git fetch origin

log_step "Resetting checkout to origin/main"
git reset --hard origin/main
git clean -fd

log_step "Installing backend dependencies"
npm install

log_step "Installing frontend dependencies"
npm --prefix frontend install

log_step "Validating Prisma schema"
npx prisma validate

log_step "Generating Prisma client"
npx prisma generate

log_step "Applying committed migrations"
npx prisma migrate deploy

log_step "Building production frontend bundle"
npm run build

restart_application

log_step "CorePOS upgrade completed successfully"
