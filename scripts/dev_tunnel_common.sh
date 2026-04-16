#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev_local_common.sh
source "$SCRIPT_DIR/dev_local_common.sh"

COREPOS_DEV_TUNNEL_ENV_FILE="${COREPOS_DEV_TUNNEL_ENV_FILE:-$COREPOS_REPO_ROOT/frontend/.env.local}"
COREPOS_DEV_TUNNEL_PID_FILE="${COREPOS_DEV_TUNNEL_PID_FILE:-$COREPOS_DEV_STATE_DIR/customer-capture-tunnel.pid}"
COREPOS_DEV_TUNNEL_LOG="${COREPOS_DEV_TUNNEL_LOG:-$COREPOS_DEV_STATE_DIR/customer-capture-tunnel.log}"
COREPOS_DEV_TUNNEL_URL_FILE="${COREPOS_DEV_TUNNEL_URL_FILE:-$COREPOS_DEV_STATE_DIR/customer-capture-tunnel.url}"
COREPOS_DEV_TUNNEL_TARGET_URL="${COREPOS_DEV_TUNNEL_TARGET_URL:-$COREPOS_DEV_BACKEND_URL}"
COREPOS_DEV_TUNNEL_PUBLIC_PATH="${COREPOS_DEV_TUNNEL_PUBLIC_PATH:-/customer-capture}"
COREPOS_DEV_TUNNEL_FRONTEND_API_URL="${COREPOS_DEV_TUNNEL_FRONTEND_API_URL:-http://localhost:${COREPOS_DEV_BACKEND_PORT}}"
COREPOS_DEV_TUNNEL_WAIT_SECONDS="${COREPOS_DEV_TUNNEL_WAIT_SECONDS:-20}"
COREPOS_DEV_TUNNEL_BIN="${COREPOS_DEV_TUNNEL_BIN:-cloudflared}"

fail_dev_tunnel() {
  dev_error "$1"
  exit 1
}

require_cloudflared_binary() {
  if ! command -v "$COREPOS_DEV_TUNNEL_BIN" >/dev/null 2>&1; then
    fail_dev_tunnel "cloudflared is required for dev tunnel mode. Install it first and rerun npm run dev:tunnel."
  fi
}

require_quick_tunnel_ready_config() {
  local config_file

  for config_file in "$HOME/.cloudflared/config.yml" "$HOME/.cloudflared/config.yaml"; do
    if [[ -f "$config_file" ]]; then
      fail_dev_tunnel "Quick Tunnel mode is blocked by ${config_file}. Move or rename it before running npm run dev:tunnel."
    fi
  done
}

stop_tracked_dev_tunnel() {
  local tunnel_pid elapsed=0

  ensure_dev_state_dir

  if [[ -f "$COREPOS_DEV_TUNNEL_PID_FILE" ]]; then
    tunnel_pid="$(tr -d '[:space:]' <"$COREPOS_DEV_TUNNEL_PID_FILE")"
  else
    tunnel_pid=""
  fi

  if [[ -n "$tunnel_pid" ]] && pid_exists "$tunnel_pid"; then
    dev_log "Stopping tracked customer-capture tunnel ${tunnel_pid}"
    if is_detached_group_leader "$tunnel_pid"; then
      send_signal_to_pid_or_group "$tunnel_pid" TERM group
    else
      send_signal_to_pid_or_group "$tunnel_pid" TERM pid
    fi

    while (( elapsed < COREPOS_DEV_STOP_WAIT_SECONDS )); do
      if ! pid_exists "$tunnel_pid"; then
        break
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done

    if pid_exists "$tunnel_pid"; then
      dev_warn "Tracked tunnel ${tunnel_pid} did not stop after SIGTERM; sending SIGKILL"
      if is_detached_group_leader "$tunnel_pid"; then
        send_signal_to_pid_or_group "$tunnel_pid" KILL group
      else
        send_signal_to_pid_or_group "$tunnel_pid" KILL pid
      fi
    fi
  fi

  rm -f "$COREPOS_DEV_TUNNEL_PID_FILE" "$COREPOS_DEV_TUNNEL_URL_FILE"
}

extract_trycloudflare_url() {
  if [[ ! -f "$COREPOS_DEV_TUNNEL_LOG" ]]; then
    return 1
  fi

  grep -Eom1 'https://[a-z0-9-]+\.trycloudflare\.com' "$COREPOS_DEV_TUNNEL_LOG" || true
}

start_dev_tunnel_process() {
  ensure_dev_state_dir
  stop_tracked_dev_tunnel
  : >"$COREPOS_DEV_TUNNEL_LOG"

  dev_log "Starting Cloudflare Quick Tunnel to ${COREPOS_DEV_TUNNEL_TARGET_URL}"
  spawn_detached_process \
    "$COREPOS_DEV_TUNNEL_PID_FILE" \
    "$COREPOS_DEV_TUNNEL_LOG" \
    "$COREPOS_DEV_TUNNEL_BIN" \
    tunnel \
    --url \
    "$COREPOS_DEV_TUNNEL_TARGET_URL"
}

wait_for_dev_tunnel_url() {
  local elapsed=0 tunnel_pid tunnel_url

  tunnel_pid="$(tr -d '[:space:]' <"$COREPOS_DEV_TUNNEL_PID_FILE")"

  while (( elapsed < COREPOS_DEV_TUNNEL_WAIT_SECONDS )); do
    tunnel_url="$(extract_trycloudflare_url)"
    if [[ -n "$tunnel_url" ]]; then
      printf '%s\n' "$tunnel_url" >"$COREPOS_DEV_TUNNEL_URL_FILE"
      printf '%s\n' "$tunnel_url"
      return 0
    fi

    if [[ -n "$tunnel_pid" ]] && ! pid_exists "$tunnel_pid"; then
      tail_log_file "$COREPOS_DEV_TUNNEL_LOG" "customer-capture tunnel"
      fail_dev_tunnel "Cloudflare tunnel exited before a trycloudflare URL was available."
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  tail_log_file "$COREPOS_DEV_TUNNEL_LOG" "customer-capture tunnel"
  fail_dev_tunnel "Could not extract a trycloudflare URL from the Cloudflare tunnel output."
}

write_customer_capture_env() {
  local public_origin="${1:-}"
  local temp_file

  mkdir -p "$(dirname "$COREPOS_DEV_TUNNEL_ENV_FILE")"
  temp_file="$(mktemp)"

  if [[ -f "$COREPOS_DEV_TUNNEL_ENV_FILE" ]]; then
    awk '!/^(VITE_API_URL|VITE_PUBLIC_APP_ORIGIN)=/' "$COREPOS_DEV_TUNNEL_ENV_FILE" >"$temp_file"
  fi

  printf 'VITE_API_URL=%s\n' "$COREPOS_DEV_TUNNEL_FRONTEND_API_URL" >>"$temp_file"
  if [[ -n "$public_origin" ]]; then
    printf 'VITE_PUBLIC_APP_ORIGIN=%s\n' "$public_origin" >>"$temp_file"
  fi

  mv "$temp_file" "$COREPOS_DEV_TUNNEL_ENV_FILE"
}

rebuild_frontend_for_capture_mode() {
  dev_log "Building frontend bundle for customer-capture mode"
  (cd "$COREPOS_REPO_ROOT" && npm run build:frontend)
}

ensure_backend_tunnel_target_reachable() {
  if ! wait_for_url "$COREPOS_DEV_BACKEND_HEALTH_URL" "Backend"; then
    tail_log_file "$COREPOS_DEV_BACKEND_LOG" "backend"
    fail_dev_tunnel "Backend ${COREPOS_DEV_BACKEND_HEALTH_URL} was not reachable for tunnel setup."
  fi
}
