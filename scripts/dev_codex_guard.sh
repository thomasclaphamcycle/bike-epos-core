#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./dev_local_common.sh
source "$SCRIPT_DIR/dev_local_common.sh"

if (($# == 0)); then
  cat <<'EOF' >&2
Usage:
  scripts/dev_codex_guard.sh <command> [args...]

Example:
  scripts/dev_codex_guard.sh npm run verify
EOF
  exit 1
fi

ensure_dev_state_dir

STATE_FILE="$COREPOS_DEV_STATE_DIR/codex-guard.state"
guard_status=0
restore_status=0
restore_required=0
cleanup_ran=0

cleanup() {
  local final_status

  if (( cleanup_ran == 1 )); then
    return
  fi
  cleanup_ran=1
  trap - EXIT INT TERM

  if (( restore_required == 1 )); then
    dev_log "Restoring local inspection servers"
    if "$SCRIPT_DIR/dev_start_local.sh" --restore-state "$STATE_FILE"; then
      dev_log "Local inspection servers restored"
    else
      restore_status=$?
      dev_error "Local inspection server restore failed"
    fi
  else
    dev_log "No local inspection servers needed restoring"
  fi

  rm -f "$STATE_FILE"

  if (( guard_status == 0 )); then
    dev_log "Guarded command passed"
  else
    dev_error "Guarded command failed with exit code ${guard_status}"
  fi

  final_status=$guard_status
  if (( final_status == 0 && restore_status != 0 )); then
    final_status=$restore_status
  fi

  exit "$final_status"
}

trap cleanup EXIT INT TERM

dev_log "Stopping normal local inspection servers before guarded command"
restore_required=1
if ! COREPOS_LOCAL_DEV_STATE_FILE="$STATE_FILE" "$SCRIPT_DIR/dev_stop_local.sh"; then
  guard_status=$?
  dev_error "Unable to prepare the local dev environment for the guarded command"
  exit "$guard_status"
fi

dev_log "Running guarded command: $*"
if "$@"; then
  guard_status=0
else
  guard_status=$?
  exit "$guard_status"
fi
