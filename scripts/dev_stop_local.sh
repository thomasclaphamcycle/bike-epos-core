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
  local pid_file
  local recorded_pid
  local recorded_alive=0
  local -a orphan_pids=()

  classify_component_listeners "$component" "$port"

  if (( ${#CLASSIFIED_CONFLICTING_PIDS[@]} > 0 )); then
    for pid in "${CLASSIFIED_CONFLICTING_PIDS[@]}"; do
      dev_error "Port ${port} is occupied by a non-CorePOS ${label} process: $(describe_pid "$pid")"
    done
    had_error=1
    return
  fi

  orphan_pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    orphan_pids+=("$pid")
  done < <(list_component_orphan_pids "$component")
  pid_file="$(component_pid_file "$component")"
  recorded_pid=""
  if [[ -f "$pid_file" ]]; then
    recorded_pid="$(tr -d '[:space:]' <"$pid_file")"
    if [[ -n "$recorded_pid" ]] && pid_exists "$recorded_pid"; then
      recorded_alive=1
    fi
  fi

  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
    if [[ "$component" == "backend" ]]; then
      backend_was_running=1
    else
      frontend_was_running=1
    fi
  fi

  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} == 0 && ${#orphan_pids[@]} == 0 && recorded_alive == 0 )); then
    dev_log "No CorePOS ${label} listener or orphaned process found on port ${port}"
    rm -f "$pid_file"
    return
  fi

  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} == 0 )) && (( ${#orphan_pids[@]} > 0 )); then
    dev_warn "Found ${#orphan_pids[@]} orphaned CorePOS ${label} process(es) without an active listener on port ${port}"
  fi

  if ! stop_component_processes "$component" "$label" "$port"; then
    had_error=1
  fi
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
