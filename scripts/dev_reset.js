#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  cleanupManagedRepoProcesses,
  listListeningPidsForPort,
  repoRoot,
  snapshotManagedRepoProcesses,
} = require("./process_lifecycle");

const SCRIPT_DIR = __dirname;
const DEV_STATE_DIR = path.join(repoRoot, "tmp", "dev-local");
const TEMP_STATE_FILE = path.join(DEV_STATE_DIR, `reset-${process.pid}.state`);
const STALE_STATE_FILES = [
  "manual-servers.state",
  "codex-guard.state",
  "backend.pid",
  "frontend.pid",
];

const log = (message) => {
  console.log(`[corepos-dev] ${message}`);
};

const runStopLocal = () => {
  const result = spawnSync("bash", [path.join(SCRIPT_DIR, "dev_stop_local.sh")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      COREPOS_LOCAL_DEV_STATE_FILE: TEMP_STATE_FILE,
    },
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
};

const main = async () => {
  fs.mkdirSync(DEV_STATE_DIR, { recursive: true });

  runStopLocal();

  const snapshot = Array.from(snapshotManagedRepoProcesses().values());
  if (snapshot.length > 0) {
    log(`Cleaning ${snapshot.length} repo-managed process(es) left after local stop`);
    const cleanupResult = await cleanupManagedRepoProcesses(snapshot, {
      label: "dev reset",
      log,
      termTimeoutMs: 3000,
      killTimeoutMs: 1500,
    });

    if (cleanupResult.remaining.length > 0) {
      process.exitCode = 1;
      return;
    }
  }

  for (const stateFile of [TEMP_STATE_FILE, ...STALE_STATE_FILES.map((file) => path.join(DEV_STATE_DIR, file))]) {
    fs.rmSync(stateFile, { force: true });
  }

  const lingeringPorts = [3100, 4173, 5173].filter(
    (port) => listListeningPidsForPort(port).length > 0,
  );
  if (lingeringPorts.length > 0) {
    console.error(
      `[corepos-dev] ERROR: lingering listeners remain on ${lingeringPorts.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  log("Local repo-owned runtime state reset cleanly");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
