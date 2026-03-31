#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const {
  formatManagedRepoProcess,
  listListeningPidsForPort,
  repoRoot,
  snapshotManagedRepoProcesses,
} = require("./process_lifecycle");

const DEV_STATE_DIR = path.join(repoRoot, "tmp", "dev-local");
const PID_FILES = {
  backend: path.join(DEV_STATE_DIR, "backend.pid"),
  frontend: path.join(DEV_STATE_DIR, "frontend.pid"),
};
const PORTS = [
  { name: "backend-dev", port: 3100, url: "http://localhost:3100/health" },
  { name: "playwright-frontend", port: 4173, url: "http://localhost:4173/login" },
  { name: "frontend-dev", port: 5173, url: "http://localhost:5173/login" },
];

const log = (message = "") => {
  console.log(`[corepos-dev] ${message}`);
};

const readPidFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return null;
  }

  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

const probeUrl = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      ok: response.ok || (response.status >= 300 && response.status < 400),
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const main = async () => {
  const snapshot = Array.from(snapshotManagedRepoProcesses().values());
  const byKind = snapshot.reduce((map, processInfo) => {
    const list = map.get(processInfo.kind) || [];
    list.push(processInfo);
    map.set(processInfo.kind, list);
    return map;
  }, new Map());

  log("Runtime status");
  log(`repo: ${repoRoot}`);
  log(`tracked repo-managed processes: ${snapshot.length}`);

  for (const { name, port, url } of PORTS) {
    const listeners = listListeningPidsForPort(port);
    const health = await probeUrl(url);
    log(
      `${name}: port ${port} listeners=${
        listeners.length > 0 ? listeners.join(",") : "none"
      } health=${health.ok ? health.status : `down (${health.status})`}`,
    );
  }

  for (const [component, filePath] of Object.entries(PID_FILES)) {
    const pid = readPidFile(filePath);
    log(`${component} pid file: ${fs.existsSync(filePath) ? `${filePath} -> ${pid ?? "invalid"}` : "absent"}`);
  }

  for (const kind of ["backend", "frontend", "playwright", "smoke-wrapper"]) {
    const processes = byKind.get(kind) || [];
    log(`${kind}: ${processes.length}`);
    for (const processInfo of processes) {
      log(`  ${formatManagedRepoProcess(processInfo)}`);
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
