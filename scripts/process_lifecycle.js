#!/usr/bin/env node

const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const useProcessGroup = process.platform !== "win32";
const MANAGED_PROCESS_GROUP = Symbol("managedProcessGroup");
const DETACHED_TTYS = new Set(["?", "??"]);
const MANAGED_COMMAND_MARKERS = [
  "src/server.ts",
  "scripts/start_test_server.js",
  "vite",
  "node_modules/@playwright/test/cli.js",
  "scripts/run_smoke_test.js",
  "frontend run dev",
];
const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSnapshot = (snapshot) => {
  if (snapshot instanceof Map) {
    return new Set(snapshot.keys());
  }
  if (snapshot instanceof Set) {
    return snapshot;
  }
  return new Set();
};

const resolveSpawnCommand = (command) => {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm") {
    return "npm.cmd";
  }
  if (command === "npx") {
    return "npx.cmd";
  }

  return command;
};

const signalCodeToExitCode = (signal) => SIGNAL_EXIT_CODES[signal] ?? 1;

const childUsesManagedProcessGroup = (child, processGroupOverride) => {
  if (typeof processGroupOverride === "boolean") {
    return processGroupOverride;
  }

  if (typeof child === "number") {
    return useProcessGroup;
  }

  return child?.[MANAGED_PROCESS_GROUP] ?? useProcessGroup;
};

const installSignalHandlers = (handler, signals = ["SIGINT", "SIGTERM"]) => {
  const listeners = new Map();

  for (const signal of signals) {
    const listener = () => {
      void handler(signal);
    };
    listeners.set(signal, listener);
    process.once(signal, listener);
  }

  return () => {
    for (const [signal, listener] of listeners.entries()) {
      process.removeListener(signal, listener);
    }
    listeners.clear();
  };
};

const spawnManagedProcess = (command, args, options = {}) => {
  const detached = options.detached ?? useProcessGroup;
  const child = spawn(resolveSpawnCommand(command), args, {
    detached,
    shell: options.shell ?? false,
    ...options,
  });

  Object.defineProperty(child, MANAGED_PROCESS_GROUP, {
    value: Boolean(detached),
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return child;
};

const pidExists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
};

const sendSignalToPid = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
};

const sendSignalToChild = (child, signal, options = {}) => {
  const pid = typeof child === "number" ? child : child?.pid;
  if (!pid) {
    return false;
  }

  const processGroup = childUsesManagedProcessGroup(child, options.processGroup);
  const target = processGroup ? -pid : pid;

  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
};

const waitForChildExit = (child, timeoutMs) =>
  new Promise((resolve, reject) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Child process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("exit", handleExit);
      child.removeListener("error", handleError);
    };

    const handleExit = () => {
      cleanup();
      resolve();
    };

    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
  });

const terminateChildProcess = async (
  child,
  {
    label = "child process",
    termSignal = "SIGTERM",
    termTimeoutMs = 5000,
    killTimeoutMs = 2000,
    log = () => {},
  } = {},
) => {
  if (!child?.pid) {
    return;
  }

  const processGroup = childUsesManagedProcessGroup(child);

  try {
    log(
      `${label}: sending ${termSignal} to ${
        processGroup ? "process group" : "pid"
      } ${child.pid}`,
    );
    sendSignalToChild(child, termSignal);
    await waitForChildExit(child, termTimeoutMs);
  } catch (error) {
    log(
      `${label}: ${termSignal} cleanup did not finish cleanly (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    log(
      `${label}: sending SIGKILL to ${
        processGroup ? "process group" : "pid"
      } ${child.pid}`,
    );
    sendSignalToChild(child, "SIGKILL");
    await waitForChildExit(child, killTimeoutMs);
  }
};

const listListeningPidsForPort = (port) => {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", "-tiTCP:" + String(port), "-sTCP:LISTEN"],
      { encoding: "utf8" },
    ).trim();

    if (!output) {
      return [];
    }

    return output
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) {
      return [];
    }
    throw error;
  }
};

const waitForPortState = async (port, shouldBeListening, timeoutMs) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const listening = listListeningPidsForPort(port).length > 0;
    if (listening === shouldBeListening) {
      return true;
    }
    await sleep(100);
  }

  return false;
};

const waitForPortFree = (port, timeoutMs) => waitForPortState(port, false, timeoutMs);

const canSkipProcessTableError = (error) =>
  Boolean(
    error &&
    typeof error === "object" &&
    (
      error.code === "EPERM" ||
      error.code === "EACCES" ||
      error.code === "ENOENT"
    ),
  );

const parseProcessTable = () => {
  try {
    const output = execFileSync(
      "ps",
      ["-axo", "pid=,ppid=,pgid=,tty=,command="],
      { encoding: "utf8" },
    );

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) {
          return null;
        }

        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          pgid: Number(match[3]),
          tty: match[4],
          command: match[5],
        };
      })
      .filter(Boolean);
  } catch (error) {
    if (canSkipProcessTableError(error)) {
      return [];
    }
    throw error;
  }
};

const readProcessCwd = (pid) => {
  try {
    return execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { encoding: "utf8" },
    )
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1) ?? "";
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) {
      return "";
    }
    throw error;
  }
};

const isManagedCommandCandidate = (command) =>
  MANAGED_COMMAND_MARKERS.some((marker) => command.includes(marker));

const classifyManagedRepoProcess = (processInfo, root = repoRoot) => {
  const cwd = processInfo.cwd || "";
  const command = processInfo.command || "";
  const insideRepo =
    cwd === root ||
    cwd === path.join(root, "frontend") ||
    cwd.startsWith(`${root}/`);

  if (!insideRepo) {
    return null;
  }

  if (command.includes("src/server.ts") || command.includes("scripts/start_test_server.js")) {
    return "backend";
  }
  if (
    command.includes("vite") ||
    command.includes("npm --prefix frontend run dev") ||
    command.includes("frontend run dev")
  ) {
    return "frontend";
  }
  if (
    command.includes("node_modules/@playwright/test/cli.js") &&
    !command.includes("test-server")
  ) {
    return "playwright";
  }
  if (command.includes("scripts/run_smoke_test.js")) {
    return "smoke-wrapper";
  }

  return null;
};

const formatManagedRepoProcess = (processInfo) =>
  `pid=${processInfo.pid} ppid=${processInfo.ppid} pgid=${processInfo.pgid} tty=${processInfo.tty} kind=${processInfo.kind} cwd=${processInfo.cwd || "unknown"} cmd=${processInfo.command}`;

const snapshotManagedRepoProcesses = ({ root = repoRoot } = {}) => {
  const snapshot = new Map();

  for (const processInfo of parseProcessTable()) {
    if (!isManagedCommandCandidate(processInfo.command)) {
      continue;
    }

    const cwd = readProcessCwd(processInfo.pid);
    const enriched = {
      ...processInfo,
      cwd,
    };
    const kind = classifyManagedRepoProcess(enriched, root);

    if (!kind) {
      continue;
    }

    snapshot.set(enriched.pid, {
      ...enriched,
      kind,
    });
  }

  return snapshot;
};

const buildCleanupTargets = (processes) => {
  const groupedTargets = new Map();
  const groupedPids = new Set();
  const pidTargets = [];

  for (const processInfo of processes) {
    if (
      processInfo.pgid > 0 &&
      processInfo.pid === processInfo.pgid &&
      DETACHED_TTYS.has(processInfo.tty)
    ) {
      groupedTargets.set(processInfo.pgid, {
        type: "group",
        leader: processInfo,
        members: [],
      });
    }
  }

  for (const processInfo of processes) {
    const groupTarget = groupedTargets.get(processInfo.pgid);
    if (groupTarget) {
      groupTarget.members.push(processInfo);
      groupedPids.add(processInfo.pid);
    }
  }

  for (const processInfo of processes) {
    if (!groupedPids.has(processInfo.pid)) {
      pidTargets.push({
        type: "pid",
        processInfo,
      });
    }
  }

  return [
    ...Array.from(groupedTargets.values()),
    ...pidTargets,
  ];
};

const waitForProcessesExit = async (processes, timeoutMs) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const remaining = processes.filter((processInfo) => pidExists(processInfo.pid));
    if (remaining.length === 0) {
      return [];
    }
    await sleep(100);
  }

  return processes.filter((processInfo) => pidExists(processInfo.pid));
};

const cleanupManagedRepoProcesses = async (
  processes,
  {
    label = "managed repo process cleanup",
    log = () => {},
    termTimeoutMs = 2000,
    killTimeoutMs = 1000,
  } = {},
) => {
  const liveProcesses = processes.filter((processInfo) => pidExists(processInfo.pid));
  if (liveProcesses.length === 0) {
    return {
      cleaned: [],
      remaining: [],
    };
  }

  log(
    `${label}: cleaning up ${liveProcesses.length} lingering process(es)\n${liveProcesses
      .map((processInfo) => `  - ${formatManagedRepoProcess(processInfo)}`)
      .join("\n")}`,
  );

  for (const target of buildCleanupTargets(liveProcesses)) {
    if (target.type === "group") {
      log(
        `${label}: sending SIGTERM to process group ${target.leader.pgid} (${target.members
          .map((member) => member.pid)
          .join(", ")})`,
      );
      sendSignalToChild(target.leader.pid, "SIGTERM", { processGroup: true });
      continue;
    }

    log(`${label}: sending SIGTERM to pid ${target.processInfo.pid}`);
    sendSignalToPid(target.processInfo.pid, "SIGTERM");
  }

  let remaining = await waitForProcessesExit(liveProcesses, termTimeoutMs);
  if (remaining.length > 0) {
    for (const target of buildCleanupTargets(remaining)) {
      if (target.type === "group") {
        log(`${label}: sending SIGKILL to process group ${target.leader.pgid}`);
        sendSignalToChild(target.leader.pid, "SIGKILL", { processGroup: true });
        continue;
      }

      log(`${label}: sending SIGKILL to pid ${target.processInfo.pid}`);
      sendSignalToPid(target.processInfo.pid, "SIGKILL");
    }

    remaining = await waitForProcessesExit(remaining, killTimeoutMs);
  }

  return {
    cleaned: liveProcesses.filter(
      (processInfo) => !remaining.some((candidate) => candidate.pid === processInfo.pid),
    ),
    remaining,
  };
};

const cleanupNewManagedRepoProcesses = async (
  beforeSnapshot,
  options = {},
) => {
  const baseline = normalizeSnapshot(beforeSnapshot);
  const afterSnapshot = snapshotManagedRepoProcesses(options);
  const leakedProcesses = Array.from(afterSnapshot.values()).filter(
    (processInfo) => !baseline.has(processInfo.pid),
  );

  if (leakedProcesses.length === 0) {
    return {
      leaked: [],
      cleaned: [],
      remaining: [],
    };
  }

  const cleanupResult = await cleanupManagedRepoProcesses(leakedProcesses, options);
  return {
    leaked: leakedProcesses,
    cleaned: cleanupResult.cleaned,
    remaining: cleanupResult.remaining,
  };
};

module.exports = {
  cleanupManagedRepoProcesses,
  cleanupNewManagedRepoProcesses,
  formatManagedRepoProcess,
  installSignalHandlers,
  listListeningPidsForPort,
  pidExists,
  repoRoot,
  resolveSpawnCommand,
  sendSignalToChild,
  signalCodeToExitCode,
  snapshotManagedRepoProcesses,
  spawnManagedProcess,
  terminateChildProcess,
  useProcessGroup,
  waitForChildExit,
  waitForPortFree,
};
