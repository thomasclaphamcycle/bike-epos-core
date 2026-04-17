#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COREPOS_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LABEL="local.corepos.playwright-bridge"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="${COREPOS_REPO_ROOT}/tmp/playwright-bridge"
STDOUT_LOG="${LOG_DIR}/launchagent.stdout.log"
STDERR_LOG="${LOG_DIR}/launchagent.stderr.log"
DOMAIN_TARGET="gui/$(id -u)"
SERVICE_TARGET="${DOMAIN_TARGET}/${LABEL}"

NODE_BIN="${PLAYWRIGHT_BRIDGE_NODE_BIN:-$(command -v node || true)}"
if [[ -z "${NODE_BIN}" ]]; then
  echo "[playwright-bridge-launchagent] Could not find node on PATH." >&2
  exit 1
fi

mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}"

CHANNEL_BLOCK=""
if [[ -n "${PLAYWRIGHT_BRIDGE_CHANNEL:-}" ]]; then
  CHANNEL_BLOCK="$(cat <<EOF
    <key>EnvironmentVariables</key>
    <dict>
      <key>PLAYWRIGHT_BRIDGE_CHANNEL</key>
      <string>${PLAYWRIGHT_BRIDGE_CHANNEL}</string>
    </dict>
EOF
)"
fi

cat >"${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${NODE_BIN}</string>
      <string>${COREPOS_REPO_ROOT}/scripts/playwright_bridge.js</string>
      <string>daemon</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${COREPOS_REPO_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${STDOUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${STDERR_LOG}</string>
${CHANNEL_BLOCK}
  </dict>
</plist>
EOF

plutil -lint "${PLIST_PATH}" >/dev/null

launchctl bootout "${DOMAIN_TARGET}" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootout "${SERVICE_TARGET}" >/dev/null 2>&1 || true
launchctl enable "${SERVICE_TARGET}" >/dev/null 2>&1 || true

if ! launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_PATH}"; then
  echo "[playwright-bridge-launchagent] launchctl bootstrap failed for ${PLIST_PATH}" >&2
  echo "[playwright-bridge-launchagent] Try these commands for richer diagnostics:" >&2
  echo "  launchctl bootout ${DOMAIN_TARGET} ${PLIST_PATH} || true" >&2
  echo "  launchctl bootstrap ${DOMAIN_TARGET} ${PLIST_PATH}" >&2
  echo "  launchctl print ${SERVICE_TARGET}" >&2
  exit 1
fi

launchctl kickstart -k "${SERVICE_TARGET}"

echo "[playwright-bridge-launchagent] Installed ${LABEL}"
echo "[playwright-bridge-launchagent] plist: ${PLIST_PATH}"
echo "[playwright-bridge-launchagent] stdout log: ${STDOUT_LOG}"
echo "[playwright-bridge-launchagent] stderr log: ${STDERR_LOG}"
echo "[playwright-bridge-launchagent] Check status with: npm run e2e:bridge:status"
