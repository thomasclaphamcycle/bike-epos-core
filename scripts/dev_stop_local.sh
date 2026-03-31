#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev_local_common.sh
source "$SCRIPT_DIR/dev_local_common.sh"

STATE_FILE="${COREPOS_LOCAL_DEV_STATE_FILE:-$COREPOS_DEV_STATE_DIR/manual-servers.state}"
backend_was_running=0
frontend_was_running=0
had_error=0

stop_component() {
  local component="$1"
  local label="$2"
  local port="$3"
  local pid

  classify_component_listeners "$component" "$port"

  if (( ${#CLASSIFIED_CONFLICTING_PIDS[@]} > 0 )); then
    for pid in "${CLASSIFIED_CONFLICTING_PIDS[@]}"; do
      dev_error "Port ${port} is occupied by a non-CorePOS ${label} process: $(describe_pid "$pid")"
    done
    had_error=1
    return
  fi

  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} == 0 )); then
    dev_log "No CorePOS ${label} listener found on port ${port}"
    return
  fi

  if [[ "$component" == "backend" ]]; then
    backend_was_running=1
  else
    frontend_was_running=1
  fi

  for pid in "${CLASSIFIED_MATCHING_PIDS[@]}"; do
    if ! stop_pid_for_port "$label" "$pid" "$port" "$component"; then
      had_error=1
    fi
  done
}

ensure_dev_state_dir
write_dev_state_file "$STATE_FILE" "$backend_was_running" "$frontend_was_running"

stop_component "backend" "backend" "$COREPOS_DEV_BACKEND_PORT"
stop_component "frontend" "frontend" "$COREPOS_DEV_FRONTEND_PORT"

write_dev_state_file "$STATE_FILE" "$backend_was_running" "$frontend_was_running"

if (( backend_was_running == 0 && frontend_was_running == 0 )); then
  dev_log "Nothing to stop for the normal local inspection servers"
else
  dev_log "Recorded server state in ${STATE_FILE}"
fi

if (( had_error != 0 )); then
  exit 1
fi
