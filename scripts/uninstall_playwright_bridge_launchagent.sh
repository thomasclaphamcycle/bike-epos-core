#!/usr/bin/env bash
set -euo pipefail

LABEL="local.corepos.playwright-bridge"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
rm -f "${PLIST_PATH}"

echo "[playwright-bridge-launchagent] Removed ${LABEL}"
echo "[playwright-bridge-launchagent] plist: ${PLIST_PATH}"
