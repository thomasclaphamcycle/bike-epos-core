#!/usr/bin/env bash

if [[ "${COREPOS_DEV_LOCAL_COMMON_LOADED:-0}" == "1" ]]; then
  return 0
fi
COREPOS_DEV_LOCAL_COMMON_LOADED=1

COREPOS_DEV_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COREPOS_REPO_ROOT="$(cd "$COREPOS_DEV_SCRIPT_DIR/.." && pwd)"

COREPOS_DEV_STATE_DIR="${COREPOS_DEV_STATE_DIR:-$COREPOS_REPO_ROOT/tmp/dev-local}"
COREPOS_DEV_BACKEND_PORT="${COREPOS_DEV_BACKEND_PORT:-3100}"
COREPOS_DEV_FRONTEND_PORT="${COREPOS_DEV_FRONTEND_PORT:-5173}"
COREPOS_DEV_BACKEND_URL="${COREPOS_DEV_BACKEND_URL:-http://localhost:${COREPOS_DEV_BACKEND_PORT}}"
COREPOS_DEV_FRONTEND_URL="${COREPOS_DEV_FRONTEND_URL:-http://localhost:${COREPOS_DEV_FRONTEND_PORT}}"
COREPOS_DEV_BACKEND_HEALTH_URL="${COREPOS_DEV_BACKEND_HEALTH_URL:-${COREPOS_DEV_BACKEND_URL}/health}"
COREPOS_DEV_FRONTEND_HEALTH_URL="${COREPOS_DEV_FRONTEND_HEALTH_URL:-${COREPOS_DEV_FRONTEND_URL}/login}"
COREPOS_DEV_BACKEND_LOG="${COREPOS_DEV_BACKEND_LOG:-$COREPOS_DEV_STATE_DIR/backend.log}"
COREPOS_DEV_FRONTEND_LOG="${COREPOS_DEV_FRONTEND_LOG:-$COREPOS_DEV_STATE_DIR/frontend.log}"
COREPOS_DEV_BACKEND_PID_FILE="${COREPOS_DEV_BACKEND_PID_FILE:-$COREPOS_DEV_STATE_DIR/backend.pid}"
COREPOS_DEV_FRONTEND_PID_FILE="${COREPOS_DEV_FRONTEND_PID_FILE:-$COREPOS_DEV_STATE_DIR/frontend.pid}"
COREPOS_DEV_STOP_WAIT_SECONDS="${COREPOS_DEV_STOP_WAIT_SECONDS:-15}"
COREPOS_DEV_START_WAIT_SECONDS="${COREPOS_DEV_START_WAIT_SECONDS:-30}"

CLASSIFIED_MATCHING_PIDS=()
CLASSIFIED_CONFLICTING_PIDS=()

ensure_dev_state_dir() {
  mkdir -p "$COREPOS_DEV_STATE_DIR"
}

dev_log() {
  printf '[corepos-dev] %s\n' "$1"
}

dev_warn() {
  printf '[corepos-dev] WARNING: %s\n' "$1" >&2
}

dev_error() {
  printf '[corepos-dev] ERROR: %s\n' "$1" >&2
}

list_listening_pids_for_port() {
  local port="$1"
  local output status

  set +e
  output="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)"
  status=$?
  set -e

  if [[ $status -eq 1 || -z "$output" ]]; then
    return 0
  fi
  if [[ $status -ne 0 ]]; then
    return "$status"
  fi

  printf '%s\n' "$output" | awk '!seen[$0]++'
}

pid_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

pid_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

describe_pid() {
  local pid="$1"
  local command cwd

  command="$(pid_command "$pid")"
  cwd="$(pid_cwd "$pid")"

  printf 'pid=%s cwd=%s cmd=%s' \
    "$pid" \
    "${cwd:-unknown}" \
    "${command:-unknown}"
}

is_corepos_backend_pid() {
  local pid="$1"
  local command cwd

  command="$(pid_command "$pid")"
  cwd="$(pid_cwd "$pid")"

  if [[ "$cwd" != "$COREPOS_REPO_ROOT" ]]; then
    return 1
  fi

  [[ "$command" == *"src/server.ts"* || "$command" == *"ts-node-dev"* || "$command" == *"bike-epos-core"* ]]
}

is_corepos_frontend_pid() {
  local pid="$1"
  local command cwd

  command="$(pid_command "$pid")"
  cwd="$(pid_cwd "$pid")"

  if [[ "$cwd" != "$COREPOS_REPO_ROOT/frontend" ]]; then
    return 1
  fi

  [[ "$command" == *"vite"* || "$command" == *"frontend"* ]]
}

classify_component_listeners() {
  local component="$1"
  local port="$2"
  local pid

  CLASSIFIED_MATCHING_PIDS=()
  CLASSIFIED_CONFLICTING_PIDS=()

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$component" == "backend" ]]; then
      if is_corepos_backend_pid "$pid"; then
        CLASSIFIED_MATCHING_PIDS+=("$pid")
      else
        CLASSIFIED_CONFLICTING_PIDS+=("$pid")
      fi
      continue
    fi

    if [[ "$component" == "frontend" ]]; then
      if is_corepos_frontend_pid "$pid"; then
        CLASSIFIED_MATCHING_PIDS+=("$pid")
      else
        CLASSIFIED_CONFLICTING_PIDS+=("$pid")
      fi
    fi
  done < <(list_listening_pids_for_port "$port")
}

wait_for_port_free() {
  local port="$1"
  local timeout_seconds="$2"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if [[ -z "$(list_listening_pids_for_port "$port")" ]]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

stop_pid_for_port() {
  local label="$1"
  local pid="$2"
  local port="$3"

  dev_log "Stopping ${label} (${pid}) on port ${port}"
  kill "$pid" 2>/dev/null || true

  if wait_for_port_free "$port" "$COREPOS_DEV_STOP_WAIT_SECONDS"; then
    dev_log "${label} stopped cleanly"
    return 0
  fi

  dev_warn "${label} did not stop after SIGTERM; sending SIGKILL to ${pid}"
  kill -9 "$pid" 2>/dev/null || true

  if wait_for_port_free "$port" "$COREPOS_DEV_STOP_WAIT_SECONDS"; then
    dev_log "${label} stopped after SIGKILL"
    return 0
  fi

  dev_error "${label} still appears to be listening on port ${port}"
  return 1
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local timeout_seconds="${3:-$COREPOS_DEV_START_WAIT_SECONDS}"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then
      dev_log "${label} is ready at ${url}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  dev_error "${label} did not become ready at ${url}"
  return 1
}

tail_log_file() {
  local file="$1"
  local label="$2"

  if [[ -f "$file" ]]; then
    dev_warn "Last ${label} log lines from ${file}:"
    tail -n 40 "$file" >&2
  fi
}

spawn_detached_process() {
  local pid_file="$1"
  local log_file="$2"
  shift 2

  nohup perl -MPOSIX=setsid -e '
    POSIX::setsid() or die "setsid failed: $!";
    exec @ARGV or die "exec failed: $!";
  ' "$@" </dev/null >>"$log_file" 2>&1 &

  printf '%s\n' "$!" >"$pid_file"
}

write_dev_state_file() {
  local state_file="$1"
  local backend_was_running="$2"
  local frontend_was_running="$3"

  ensure_dev_state_dir
  cat >"$state_file" <<EOF
BACKEND_WAS_RUNNING=${backend_was_running}
FRONTEND_WAS_RUNNING=${frontend_was_running}
EOF
}

load_dev_state_file() {
  local state_file="$1"

  BACKEND_WAS_RUNNING=0
  FRONTEND_WAS_RUNNING=0

  if [[ ! -f "$state_file" ]]; then
    return 0
  fi

  # shellcheck disable=SC1090
  source "$state_file"
}
