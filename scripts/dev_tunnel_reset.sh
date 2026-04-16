#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev_tunnel_common.sh
source "$SCRIPT_DIR/dev_tunnel_common.sh"

STATE_FILE="$COREPOS_DEV_STATE_DIR/dev-tunnel-reset.state"
reset_completed=0

cleanup() {
  if (( reset_completed == 1 )); then
    rm -f "$STATE_FILE"
    return
  fi

  if [[ -f "$STATE_FILE" ]]; then
    dev_warn "Tunnel reset failed; restoring the prior local inspection server state"
    "$SCRIPT_DIR/dev_start_local.sh" --restore-state "$STATE_FILE" || true
    rm -f "$STATE_FILE"
  fi
}

trap cleanup EXIT

ensure_dev_state_dir

dev_log "Stopping current local inspection servers before resetting tunnel mode"
COREPOS_LOCAL_DEV_STATE_FILE="$STATE_FILE" "$SCRIPT_DIR/dev_stop_local.sh"

stop_tracked_dev_tunnel

dev_log "Restoring frontend/.env.local to normal local mode"
write_customer_capture_env
rebuild_frontend_for_capture_mode

dev_log "Restarting normal local inspection servers"
"$SCRIPT_DIR/dev_start_local.sh"
ensure_backend_tunnel_target_reachable

reset_completed=1
rm -f "$STATE_FILE"

dev_log "Customer-capture tunnel mode reset to normal local development"
printf '\n'
printf 'Local frontend API URL: %s\n' "$COREPOS_DEV_TUNNEL_FRONTEND_API_URL"
printf 'VITE_PUBLIC_APP_ORIGIN has been cleared from frontend/.env.local.\n'
