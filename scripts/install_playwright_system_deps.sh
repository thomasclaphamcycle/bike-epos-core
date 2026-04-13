#!/usr/bin/env bash

set -euo pipefail

browser="${1:-chromium}"
max_attempts="${APT_INSTALL_MAX_ATTEMPTS:-3}"
retry_sleep_seconds="${APT_INSTALL_RETRY_SLEEP_SECONDS:-15}"
apt_retries="${APT_ACQUIRE_RETRIES:-3}"
apt_timeout_seconds="${APT_ACQUIRE_TIMEOUT_SECONDS:-30}"

packages="$(
  node - "$browser" <<'NODE'
const browser = process.argv[2] || "chromium";
const { deps } = require("./node_modules/playwright-core/lib/server/registry/nativeDeps");
const { hostPlatform } = require("./node_modules/playwright-core/lib/server/utils/hostPlatform");

const platformDeps = deps[hostPlatform];
if (!platformDeps) {
  console.error(`No Playwright native dependency map found for ${hostPlatform}.`);
  process.exit(1);
}

const browserPackages = [...new Set(platformDeps[browser] || [])];
if (browserPackages.length === 0) {
  console.error(`No Playwright native dependency list found for ${browser} on ${hostPlatform}.`);
  process.exit(1);
}

process.stdout.write(browserPackages.join(" "));
NODE
)"

readonly packages

apt_opts=(
  -o "Acquire::Retries=${apt_retries}"
  -o "Acquire::http::Timeout=${apt_timeout_seconds}"
  -o "Acquire::https::Timeout=${apt_timeout_seconds}"
)

run_apt_with_retries() {
  local description="$1"
  shift

  local attempt=1
  while true; do
    echo "[ci] ${description} (attempt ${attempt}/${max_attempts})"
    if sudo env DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" "$@"; then
      return 0
    fi

    if [[ "$attempt" -ge "$max_attempts" ]]; then
      echo "[ci] ${description} failed after ${attempt} attempts." >&2
      return 1
    fi

    echo "[ci] ${description} failed; retrying in ${retry_sleep_seconds}s." >&2
    sleep "${retry_sleep_seconds}"
    attempt=$((attempt + 1))
  done
}

echo "[ci] Installing Playwright system dependencies for ${browser}: ${packages}"
run_apt_with_retries "apt-get update" update
run_apt_with_retries \
  "apt-get install Playwright ${browser} dependencies" \
  install \
  -y \
  --no-install-recommends \
  ${packages}
