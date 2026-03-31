#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev_local_common.sh
source "$SCRIPT_DIR/dev_local_common.sh"

usage() {
  cat <<'EOF' >&2
Usage:
  scripts/dev_start_local.sh
  scripts/dev_start_local.sh --restore-state <state-file>
EOF
}

RESTORE_STATE_FILE=""

while (($# > 0)); do
  case "$1" in
    --restore-state)
      if (($# < 2)); then
        usage
        exit 1
      fi
      RESTORE_STATE_FILE="$2"
      shift 2
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

ensure_dev_state_dir

requested_backend=1
requested_frontend=1
started_backend=0
started_frontend=0

cleanup_started_components() {
  trap - EXIT

  if (( started_frontend == 1 )) && [[ -f "$COREPOS_DEV_FRONTEND_PID_FILE" ]]; then
    classify_component_listeners "frontend" "$COREPOS_DEV_FRONTEND_PORT"
    if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
      stop_pid_for_port "frontend" "${CLASSIFIED_MATCHING_PIDS[0]}" "$COREPOS_DEV_FRONTEND_PORT" "frontend" || true
    else
      kill "$(cat "$COREPOS_DEV_FRONTEND_PID_FILE")" 2>/dev/null || true
    fi
  fi

  if (( started_backend == 1 )) && [[ -f "$COREPOS_DEV_BACKEND_PID_FILE" ]]; then
    classify_component_listeners "backend" "$COREPOS_DEV_BACKEND_PORT"
    if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
      stop_pid_for_port "backend" "${CLASSIFIED_MATCHING_PIDS[0]}" "$COREPOS_DEV_BACKEND_PORT" "backend" || true
    else
      kill "$(cat "$COREPOS_DEV_BACKEND_PID_FILE")" 2>/dev/null || true
    fi
  fi
}

trap cleanup_started_components EXIT

if [[ -n "$RESTORE_STATE_FILE" ]]; then
  load_dev_state_file "$RESTORE_STATE_FILE"
  requested_backend="${BACKEND_WAS_RUNNING:-0}"
  requested_frontend="${FRONTEND_WAS_RUNNING:-0}"
fi

if (( requested_backend == 0 && requested_frontend == 0 )); then
  dev_log "No local inspection servers were marked for restore"
  trap - EXIT
  exit 0
fi

start_backend() {
  local pid

  classify_component_listeners "backend" "$COREPOS_DEV_BACKEND_PORT"

  if (( ${#CLASSIFIED_CONFLICTING_PIDS[@]} > 0 )); then
    dev_error "Port ${COREPOS_DEV_BACKEND_PORT} is already in use by a non-CorePOS process: $(describe_pid "${CLASSIFIED_CONFLICTING_PIDS[0]}")"
    return 1
  fi

  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
    pid="${CLASSIFIED_MATCHING_PIDS[0]}"
    printf '%s\n' "$pid" >"$COREPOS_DEV_BACKEND_PID_FILE"
    dev_log "Backend already running on ${COREPOS_DEV_BACKEND_URL} (${pid})"
    return 0
  fi

  : >"$COREPOS_DEV_BACKEND_LOG"
  dev_log "Starting backend on ${COREPOS_DEV_BACKEND_URL}"
  spawn_detached_process \
    "$COREPOS_DEV_BACKEND_PID_FILE" \
    "$COREPOS_DEV_BACKEND_LOG" \
    env \
    COREPOS_REPO_ROOT="$COREPOS_REPO_ROOT" \
    PORT="$COREPOS_DEV_BACKEND_PORT" \
    bash \
    -lc \
    'cd "$COREPOS_REPO_ROOT" && exec npm run dev'
  started_backend=1
  pid="$(cat "$COREPOS_DEV_BACKEND_PID_FILE")"
  dev_log "Backend started in background with PID ${pid}; log: ${COREPOS_DEV_BACKEND_LOG}"

  if ! wait_for_url "$COREPOS_DEV_BACKEND_HEALTH_URL" "Backend"; then
    tail_log_file "$COREPOS_DEV_BACKEND_LOG" "backend"
    return 1
  fi

  classify_component_listeners "backend" "$COREPOS_DEV_BACKEND_PORT"
  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
    printf '%s\n' "${CLASSIFIED_MATCHING_PIDS[0]}" >"$COREPOS_DEV_BACKEND_PID_FILE"
  fi

  return 0
}

start_frontend() {
  local pid

  classify_component_listeners "frontend" "$COREPOS_DEV_FRONTEND_PORT"

  if (( ${#CLASSIFIED_CONFLICTING_PIDS[@]} > 0 )); then
    dev_error "Port ${COREPOS_DEV_FRONTEND_PORT} is already in use by a non-CorePOS process: $(describe_pid "${CLASSIFIED_CONFLICTING_PIDS[0]}")"
    return 1
  fi

  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
    pid="${CLASSIFIED_MATCHING_PIDS[0]}"
    printf '%s\n' "$pid" >"$COREPOS_DEV_FRONTEND_PID_FILE"
    dev_log "Frontend already running on ${COREPOS_DEV_FRONTEND_URL} (${pid})"
    return 0
  fi

  : >"$COREPOS_DEV_FRONTEND_LOG"
  dev_log "Starting frontend on ${COREPOS_DEV_FRONTEND_URL}"
  spawn_detached_process \
    "$COREPOS_DEV_FRONTEND_PID_FILE" \
    "$COREPOS_DEV_FRONTEND_LOG" \
    env \
    COREPOS_REPO_ROOT="$COREPOS_REPO_ROOT" \
    COREPOS_DEV_FRONTEND_PORT="$COREPOS_DEV_FRONTEND_PORT" \
    bash \
    -lc \
    'cd "$COREPOS_REPO_ROOT" && exec npm --prefix frontend run dev -- --host localhost --port "$COREPOS_DEV_FRONTEND_PORT" --strictPort'
  started_frontend=1
  pid="$(cat "$COREPOS_DEV_FRONTEND_PID_FILE")"
  dev_log "Frontend started in background with PID ${pid}; log: ${COREPOS_DEV_FRONTEND_LOG}"

  if ! wait_for_url "$COREPOS_DEV_FRONTEND_HEALTH_URL" "Frontend"; then
    tail_log_file "$COREPOS_DEV_FRONTEND_LOG" "frontend"
    return 1
  fi

  classify_component_listeners "frontend" "$COREPOS_DEV_FRONTEND_PORT"
  if (( ${#CLASSIFIED_MATCHING_PIDS[@]} > 0 )); then
    printf '%s\n' "${CLASSIFIED_MATCHING_PIDS[0]}" >"$COREPOS_DEV_FRONTEND_PID_FILE"
  fi

  return 0
}

if (( requested_backend == 1 )); then
  start_backend
fi

if (( requested_frontend == 1 )); then
  start_frontend
fi

trap - EXIT
dev_log "Local inspection server startup finished"
