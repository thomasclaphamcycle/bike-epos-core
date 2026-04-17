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

array_contains() {
  local needle="$1"
  shift
  local value

  for value in "$@"; do
    if [[ "$value" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

component_pid_file() {
  local component="$1"

  if [[ "$component" == "backend" ]]; then
    printf '%s\n' "$COREPOS_DEV_BACKEND_PID_FILE"
    return
  fi

  printf '%s\n' "$COREPOS_DEV_FRONTEND_PID_FILE"
}

pid_exists() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

component_probe_url() {
  local component="$1"
  local port="$2"

  if [[ "$component" == "backend" ]]; then
    printf 'http://localhost:%s/health\n' "$port"
    return
  fi

  printf 'http://localhost:%s/login\n' "$port"
}

component_port_looks_like_corepos() {
  local component="$1"
  local port="$2"
  local url response http_code

  url="$(component_probe_url "$component" "$port")"

  if [[ "$component" == "backend" ]]; then
    response="$(curl --silent --show-error --max-time 2 "$url" 2>/dev/null || true)"
    [[ "$response" == *'"status":"ok"'* ]]
    return
  fi

  http_code="$(curl --silent --show-error --location --output /dev/null --write-out '%{http_code}' --max-time 2 "$url" 2>/dev/null || true)"
  [[ "$http_code" == "200" ]]
}

pid_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

pid_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

pid_ppid() {
  local pid="$1"
  ps -p "$pid" -o ppid= 2>/dev/null | awk '{$1=$1; print}' || true
}

pid_pgid() {
  local pid="$1"
  ps -p "$pid" -o pgid= 2>/dev/null | awk '{$1=$1; print}' || true
}

pid_tty() {
  local pid="$1"
  ps -p "$pid" -o tty= 2>/dev/null | awk '{$1=$1; print}' || true
}

describe_pid() {
  local pid="$1"
  local command cwd ppid pgid tty

  command="$(pid_command "$pid")"
  cwd="$(pid_cwd "$pid")"
  ppid="$(pid_ppid "$pid")"
  pgid="$(pid_pgid "$pid")"
  tty="$(pid_tty "$pid")"

  printf 'pid=%s ppid=%s pgid=%s tty=%s cwd=%s cmd=%s' \
    "$pid" \
    "${ppid:-unknown}" \
    "${pgid:-unknown}" \
    "${tty:-unknown}" \
    "${cwd:-unknown}" \
    "${command:-unknown}"
}

is_detached_group_leader() {
  local pid="$1"
  local pgid tty

  pgid="$(pid_pgid "$pid")"
  tty="$(pid_tty "$pid")"

  [[ -n "$pgid" && "$pgid" == "$pid" && ( -z "$tty" || "$tty" == "?" || "$tty" == "??" ) ]]
}

component_matches_pid() {
  local component="$1"
  local pid="$2"
  local command cwd

  command="$(pid_command "$pid")"
  cwd="$(pid_cwd "$pid")"

  if [[ "$component" == "backend" ]]; then
    [[ "$cwd" == "$COREPOS_REPO_ROOT" ]] || return 1
    if [[ "$command" == *"node_modules/ts-node-dev"* || "$command" == node*ts-node-dev* ]]; then
      return 0
    fi
    if [[ ( "$command" == *"npm run dev" || "$command" == *"npm run dev "* ) && "$command" == *"npm"* ]]; then
      return 0
    fi
    if [[ "$command" == *"ts-node --transpile-only src/server.ts"* && "$command" == *"node"* ]]; then
      return 0
    fi
    if [[ "$command" == *"scripts/start_test_server.js"* && "$command" == *"node"* ]]; then
      return 0
    fi
    [[ "$command" == *"src/server.ts"* && ( "$command" == node* || "$command" == *"/node "* || "$command" == *" ts-node "* ) ]]
    return
  fi

  [[ "$cwd" == "$COREPOS_REPO_ROOT" || "$cwd" == "$COREPOS_REPO_ROOT/frontend" ]] || return 1
  if [[ ( "$command" == *"frontend run dev" || "$command" == *"frontend run dev "* ) && "$command" == *"npm"* ]]; then
    return 0
  fi
  if [[ ( "$command" == *"npm --prefix frontend run dev" || "$command" == *"npm --prefix frontend run dev "* ) && "$command" == *"npm"* ]]; then
    return 0
  fi
  [[ "$command" == *"vite"* && ( "$command" == node* || "$command" == *"/node "* || "$command" == *"npm"* ) ]]
}

is_corepos_backend_pid() {
  component_matches_pid "backend" "$1"
}

is_corepos_frontend_pid() {
  component_matches_pid "frontend" "$1"
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

list_component_process_pids() {
  local component="$1"
  local pid command marker_a marker_b marker_c marker_d
  local self_pid="${BASHPID:-$$}"
  local parent_pid="${PPID:-0}"

  if [[ "$component" == "backend" ]]; then
    marker_a="src/server.ts"
    marker_b="ts-node-dev"
    marker_c="npm run dev"
    marker_d="scripts/start_test_server.js"
  else
    marker_a="vite"
    marker_b="frontend run dev"
    marker_c="npm --prefix frontend run dev"
    marker_d=""
  fi

  while IFS= read -r line; do
    pid="${line%% *}"
    command="${line#* }"
    [[ -n "$pid" ]] || continue
    if [[ "$pid" == "$self_pid" || "$pid" == "$parent_pid" ]]; then
      continue
    fi
    if [[ "$command" != *"$marker_a"* && "$command" != *"$marker_b"* && "$command" != *"$marker_c"* && ( -z "$marker_d" || "$command" != *"$marker_d"* ) ]]; then
      continue
    fi
    if component_matches_pid "$component" "$pid"; then
      printf '%s\n' "$pid"
    fi
  done < <(ps -Ao pid=,command= 2>/dev/null | sed 's/^ *//')
}

list_component_orphan_pids() {
  local component="$1"
  local pid ppid tty

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    ppid="$(pid_ppid "$pid")"
    tty="$(pid_tty "$pid")"
    if [[ "$ppid" == "1" || "$tty" == "?" || "$tty" == "??" ]]; then
      printf '%s\n' "$pid"
    fi
  done < <(list_component_process_pids "$component")
}

classify_component_listeners() {
  local component="$1"
  local port="$2"
  local pid
  local port_matches_corepos=0

  CLASSIFIED_MATCHING_PIDS=()
  CLASSIFIED_CONFLICTING_PIDS=()

  if component_port_looks_like_corepos "$component" "$port"; then
    port_matches_corepos=1
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$component" == "backend" ]]; then
      if is_corepos_backend_pid "$pid"; then
        CLASSIFIED_MATCHING_PIDS+=("$pid")
      elif (( port_matches_corepos == 1 )); then
        CLASSIFIED_MATCHING_PIDS+=("$pid")
      else
        CLASSIFIED_CONFLICTING_PIDS+=("$pid")
      fi
      continue
    fi

    if is_corepos_frontend_pid "$pid"; then
      CLASSIFIED_MATCHING_PIDS+=("$pid")
    elif (( port_matches_corepos == 1 )); then
      CLASSIFIED_MATCHING_PIDS+=("$pid")
    else
      CLASSIFIED_CONFLICTING_PIDS+=("$pid")
    fi
  done < <(list_listening_pids_for_port "$port")
}

send_signal_to_pid_or_group() {
  local pid="$1"
  local signal="$2"
  local mode="${3:-pid}"
  local pgid

  if [[ "$mode" == "group" ]]; then
    pgid="$(pid_pgid "$pid")"
    if [[ -n "$pgid" ]]; then
      kill -s "$signal" -- "-$pgid" 2>/dev/null || true
      return
    fi
  fi

  kill -s "$signal" "$pid" 2>/dev/null || true
}

wait_for_component_stopped() {
  local component="$1"
  local port="$2"
  local timeout_seconds="$3"
  local elapsed=0
  local -a running_pids=()

  while (( elapsed < timeout_seconds )); do
    running_pids=()
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      running_pids+=("$pid")
    done < <(list_component_process_pids "$component")
    if [[ -z "$(list_listening_pids_for_port "$port")" ]] && (( ${#running_pids[@]} == 0 )); then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

stop_component_processes() {
  local component="$1"
  local label="$2"
  local port="$3"
  local pid_file leader_pid target_pid
  local -a process_pids=()
  local -a seen_pids=()

  pid_file="$(component_pid_file "$component")"
  leader_pid=""

  if [[ -f "$pid_file" ]]; then
    leader_pid="$(tr -d '[:space:]' <"$pid_file")"
  fi

  process_pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    process_pids+=("$pid")
  done < <(list_component_process_pids "$component")

  for pid in "${CLASSIFIED_MATCHING_PIDS[@]}"; do
    [[ -n "$pid" ]] || continue
    process_pids+=("$pid")
  done

  if [[ -n "$leader_pid" ]] && pid_exists "$leader_pid"; then
    process_pids=("$leader_pid" "${process_pids[@]}")
  fi

  if (( ${#process_pids[@]} == 0 )); then
    rm -f "$pid_file"
    return 0
  fi

  if [[ -n "$leader_pid" ]] && pid_exists "$leader_pid"; then
    if is_detached_group_leader "$leader_pid"; then
      dev_log "Stopping ${label} process group ${leader_pid}"
      send_signal_to_pid_or_group "$leader_pid" TERM group
      seen_pids+=("$leader_pid")
    else
      dev_warn "Recorded ${label} PID ${leader_pid} is not a detached group leader; stopping it directly"
      dev_log "Stopping ${label} process ${leader_pid}"
      send_signal_to_pid_or_group "$leader_pid" TERM pid
      seen_pids+=("$leader_pid")
    fi
  fi

  for target_pid in "${process_pids[@]}"; do
    [[ -n "$target_pid" ]] || continue
    if (( ${#seen_pids[@]} > 0 )) && array_contains "$target_pid" "${seen_pids[@]}"; then
      continue
    fi
    if ! pid_exists "$target_pid"; then
      continue
    fi
    dev_log "Stopping ${label} process ${target_pid}"
    send_signal_to_pid_or_group "$target_pid" TERM pid
    seen_pids+=("$target_pid")
  done

  if wait_for_component_stopped "$component" "$port" "$COREPOS_DEV_STOP_WAIT_SECONDS"; then
    rm -f "$pid_file"
    dev_log "${label} stopped cleanly"
    return 0
  fi

  dev_warn "${label} still has live processes after SIGTERM; escalating cleanup"

  if [[ -n "$leader_pid" ]] && pid_exists "$leader_pid" && is_detached_group_leader "$leader_pid"; then
    dev_warn "Sending SIGKILL to ${label} process group ${leader_pid}"
    send_signal_to_pid_or_group "$leader_pid" KILL group
  fi

  process_pids=()
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    process_pids+=("$pid")
  done < <(list_component_process_pids "$component")
  for target_pid in "${process_pids[@]}"; do
    [[ -n "$target_pid" ]] || continue
    if pid_exists "$target_pid"; then
      dev_warn "Sending SIGKILL to lingering ${label} process ${target_pid}"
      send_signal_to_pid_or_group "$target_pid" KILL pid
    fi
  done

  if wait_for_component_stopped "$component" "$port" "$COREPOS_DEV_STOP_WAIT_SECONDS"; then
    rm -f "$pid_file"
    dev_log "${label} stopped after forced cleanup"
    return 0
  fi

  dev_error "${label} still appears to be running after forced cleanup"
  rm -f "$pid_file"
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
