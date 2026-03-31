#!/usr/bin/env node

const {
  formatManagedRepoProcess,
  listListeningPidsForPort,
  snapshotManagedRepoProcesses,
} = require("./process_lifecycle");

const DETACHED_TTYS = new Set(["", "?", "??"]);

const isSuspiciousVerifyProcess = (processInfo) => {
  if (processInfo.kind === "playwright" || processInfo.kind === "smoke-wrapper") {
    return true;
  }

  if (processInfo.kind === "backend") {
    return (
      processInfo.command.includes("scripts/start_test_server.js") ||
      DETACHED_TTYS.has(processInfo.tty || "")
    );
  }

  if (processInfo.kind === "frontend") {
    return processInfo.command.includes("4173");
  }

  return false;
};

const main = () => {
  const processes = Array.from(snapshotManagedRepoProcesses().values());
  const suspiciousProcesses = processes.filter(isSuspiciousVerifyProcess);
  const suspiciousProcessPids = new Set(suspiciousProcesses.map((processInfo) => processInfo.pid));
  const suspiciousPorts = [
    { port: 3100, pids: listListeningPidsForPort(3100).filter((pid) => suspiciousProcessPids.has(pid)) },
    { port: 4173, pids: listListeningPidsForPort(4173) },
  ].filter((entry) => entry.pids.length > 0);

  if (suspiciousProcesses.length === 0 && suspiciousPorts.length === 0) {
    console.log("[verify-postflight] No repo-scoped verification leftovers detected");
    return;
  }

  console.error("[verify-postflight] Repo-scoped verification leftovers detected");

  if (suspiciousProcesses.length > 0) {
    console.error(
      suspiciousProcesses
        .map((processInfo) => `  - ${formatManagedRepoProcess(processInfo)}`)
        .join("\n"),
    );
  }

  if (suspiciousPorts.length > 0) {
    console.error(
      suspiciousPorts
        .map((entry) => `  - port ${entry.port} listeners: ${entry.pids.join(", ")}`)
        .join("\n"),
    );
  }

  process.exit(1);
};

main();
