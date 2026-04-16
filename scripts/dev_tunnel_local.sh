#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev_tunnel_common.sh
source "$SCRIPT_DIR/dev_tunnel_common.sh"

STATE_FILE="$COREPOS_DEV_STATE_DIR/dev-tunnel-setup.state"
setup_completed=0
restart_completed=0
tunnel_started=0

cleanup() {
  if (( setup_completed == 1 )); then
    rm -f "$STATE_FILE"
    return
  fi

  if (( tunnel_started == 1 )); then
    stop_tracked_dev_tunnel || true
  fi

  if [[ -f "$STATE_FILE" ]]; then
    dev_warn "Tunnel setup failed; restoring the prior local inspection server state"
    "$SCRIPT_DIR/dev_start_local.sh" --restore-state "$STATE_FILE" || true
    rm -f "$STATE_FILE"
  elif (( restart_completed == 0 )); then
    dev_warn "Tunnel setup failed before restart completed; attempting to bring normal local inspection servers back up"
    "$SCRIPT_DIR/dev_start_local.sh" || true
  fi
}

trap cleanup EXIT

ensure_dev_state_dir
require_cloudflared_binary
require_quick_tunnel_ready_config

dev_log "Stopping current local inspection servers before tunnel setup"
COREPOS_LOCAL_DEV_STATE_FILE="$STATE_FILE" "$SCRIPT_DIR/dev_stop_local.sh"

dev_log "Starting normal local inspection servers for tunnel preflight"
"$SCRIPT_DIR/dev_start_local.sh"
ensure_backend_tunnel_target_reachable

start_dev_tunnel_process
tunnel_started=1
TUNNEL_URL="$(wait_for_dev_tunnel_url)"

dev_log "Writing frontend/.env.local for customer-capture tunnel mode"
write_customer_capture_env "$TUNNEL_URL"
rebuild_frontend_for_capture_mode

dev_log "Restarting local inspection servers so backend serves the rebuilt bundle"
"$SCRIPT_DIR/dev_stop_local.sh"
"$SCRIPT_DIR/dev_start_local.sh"
restart_completed=1
ensure_backend_tunnel_target_reachable

setup_completed=1
rm -f "$STATE_FILE"

dev_log "Customer-capture tunnel ready"
printf '\n'
printf 'Tunnel URL: %s\n' "$TUNNEL_URL"
printf 'Capture base URL: %s%s\n' "$TUNNEL_URL" "$COREPOS_DEV_TUNNEL_PUBLIC_PATH"
printf 'Reminder: hard refresh the browser, then generate a fresh tap request and use the newest link only.\n'
