#!/usr/bin/env node
require("dotenv/config");

const { execFileSync, spawn } = require("node:child_process");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const trimLog = (value, maxChars) =>
  value.length > maxChars ? value.slice(value.length - maxChars) : value;

const createSmokeServerController = ({
  label,
  baseUrl,
  baseUrls,
  databaseUrl,
  startup = {
    command: "npm",
    args: ["run", "dev"],
  },
  startupIntervalMs = 500,
  startupChecks = 60,
  shutdownTimeoutMs = 5000,
  shutdownPollMs = 250,
  healthCheckTimeoutMs = 2000,
  envOverrides = {},
  captureStartupLog = false,
  startupLogCharLimit = 4000,
  startupReadyPattern = null,
  startupReadyIntervalMs = 250,
} = {}) => {
  if (!label) {
    throw new Error("label is required");
  }
  if (!baseUrl && (!Array.isArray(baseUrls) || baseUrls.length === 0)) {
    throw new Error("baseUrl or baseUrls is required");
  }

  const normalizedBaseUrls = Array.from(new Set(
    (Array.isArray(baseUrls) && baseUrls.length > 0 ? baseUrls : [baseUrl])
      .filter(Boolean)
      .map((value) => value.replace(/\/$/, "")),
  ));
  const defaultBaseUrl = normalizedBaseUrls[0];
  const listenPorts = normalizedBaseUrls.map((value) => {
    const parsed = new URL(value);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  });
  const log = (message) => {
    console.log(`[${label}] ${message}`);
  };

  let activeBaseUrl = defaultBaseUrl;
  let lastProbeDetail = "";
  let startupLog = "";

  const fetchWithTimeout = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), healthCheckTimeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  const probeHealthyBaseUrl = async () => {
    for (const candidateBaseUrl of normalizedBaseUrls) {
      const healthUrl = `${candidateBaseUrl}/health`;
      try {
        const response = await fetchWithTimeout(healthUrl);
        lastProbeDetail = `${healthUrl} -> ${response.status}`;
        if (response.ok) {
          activeBaseUrl = candidateBaseUrl;
          return candidateBaseUrl;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        lastProbeDetail = `${healthUrl} -> ${detail}`;
      }
    }

    return null;
  };

  const serverIsHealthy = async () => {
    const healthyBaseUrl = await probeHealthyBaseUrl();
    return Boolean(healthyBaseUrl);
  };

  const waitForProcessExit = (child, timeoutMs) =>
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

  const waitForServerReady = async (child) => {
    for (let attempt = 0; attempt < startupChecks; attempt += 1) {
      if (child && child.exitCode !== null) {
        const normalizedStartupLog = startupLog.trim();
        throw new Error(
          normalizedStartupLog
            ? `Server exited before becoming healthy:\n${normalizedStartupLog}`
            : "Server exited before becoming healthy on /health",
        );
      }

      const healthyBaseUrl = await probeHealthyBaseUrl();
      if (healthyBaseUrl) {
        return;
      }

      const pollDelay =
        startupReadyPattern && startupReadyPattern.test(startupLog)
          ? startupReadyIntervalMs
          : startupIntervalMs;
      await sleep(pollDelay);
    }

    const normalizedStartupLog = startupLog.trim();
    throw new Error(
      normalizedStartupLog
        ? `Server did not become healthy on /health.\n${normalizedStartupLog}${lastProbeDetail ? `\nlast probe: ${lastProbeDetail}` : ""}`
        : `Server did not become healthy on /health${lastProbeDetail ? `\nlast probe: ${lastProbeDetail}` : ""}`,
    );
  };

  const waitForServerShutdown = async () => {
    const startedAt = Date.now();
    let lastHealthy = false;
    let lastLingeringPids = [];

    while (Date.now() - startedAt < shutdownTimeoutMs) {
      lastHealthy = await serverIsHealthy();
      lastLingeringPids = listLingeringServerPids();

      if (!lastHealthy && lastLingeringPids.length === 0) {
        return Date.now() - startedAt;
      }
      await sleep(shutdownPollMs);
    }

    const lingeringDetail =
      lastLingeringPids.length > 0
        ? `; lingering listeners: ${lastLingeringPids.join(", ")}`
        : "";
    throw new Error(
      `Server shutdown not confirmed after ${shutdownTimeoutMs}ms (${lastHealthy ? "health endpoint still responded" : "listener still present"}${lingeringDetail})`,
    );
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
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
    } catch (error) {
      if (error && typeof error === "object" && error.status === 1) {
        return [];
      }
      throw error;
    }
  };

  const listLingeringServerPids = () =>
    Array.from(
      new Set(
        listenPorts.flatMap((port) => listListeningPidsForPort(port)),
      ),
    );

  const useProcessGroup = process.platform !== "win32";
  const resolvedCommand =
    process.platform === "win32" && startup.command === "npm"
      ? "npm.cmd"
      : process.platform === "win32" && startup.command === "npx"
        ? "npx.cmd"
        : startup.command;

  const sendSignal = (child, signal) => {
    if (!child?.pid) {
      return;
    }

    const target = useProcessGroup ? -child.pid : child.pid;
    try {
      process.kill(target, signal);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ESRCH") {
        return;
      }
      throw error;
    }
  };

  let serverProcess = null;
  let startedServer = false;

  const terminatePid = (pid, signal) => {
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

  const cleanupLingeringServerListeners = async () => {
    let lingeringPids = listLingeringServerPids();
    if (lingeringPids.length === 0) {
      return false;
    }

    log(`Detected lingering server listeners on ${listenPorts.join(", ")}: ${lingeringPids.join(", ")}`);

    for (const pid of lingeringPids) {
      terminatePid(pid, "SIGTERM");
    }
    await sleep(500);

    lingeringPids = listLingeringServerPids();
    if (lingeringPids.length === 0) {
      return true;
    }

    log(`Force killing lingering server listeners: ${lingeringPids.join(", ")}`);
    for (const pid of lingeringPids) {
      terminatePid(pid, "SIGKILL");
    }
    await sleep(250);
    return true;
  };

  return {
    log,
    getBaseUrl() {
      return activeBaseUrl;
    },
    getStartupLog() {
      return startupLog;
    },
    getLastProbeDetail() {
      return lastProbeDetail;
    },
    async probeHealthyBaseUrl() {
      return probeHealthyBaseUrl();
    },
    async startIfNeeded() {
      const alreadyHealthy = await probeHealthyBaseUrl();
      if (alreadyHealthy && process.env.ALLOW_EXISTING_SERVER !== "1") {
        throw new Error(
          "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
        );
      }

      if (alreadyHealthy) {
        activeBaseUrl = alreadyHealthy;
        return false;
      }

      log(`Starting API server with ${startup.command} ${startup.args.join(" ")}`);
      serverProcess = spawn(resolvedCommand, startup.args, {
        stdio: captureStartupLog ? ["ignore", "pipe", "pipe"] : "ignore",
        detached: useProcessGroup,
        env: {
          ...process.env,
          NODE_ENV: "test",
          ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
          ...envOverrides,
        },
      });
      if (captureStartupLog) {
        const appendStartupLog = (chunk) => {
          startupLog = trimLog(`${startupLog}${String(chunk)}`, startupLogCharLimit);
        };
        serverProcess.stdout?.on("data", appendStartupLog);
        serverProcess.stderr?.on("data", appendStartupLog);
      }
      startedServer = true;
      await waitForServerReady(serverProcess);
      return true;
    },
    async stop() {
      if (!startedServer || !serverProcess) {
        return;
      }

      log("Starting API server cleanup");

      try {
        log(`Sending SIGTERM to ${useProcessGroup ? "process group" : "server process"} ${serverProcess.pid}`);
        sendSignal(serverProcess, "SIGTERM");
        await waitForProcessExit(serverProcess, 5000);
        log("Server process exited after SIGTERM");
      } catch (error) {
        log(`SIGTERM cleanup did not finish cleanly: ${error.message}`);
        log(`Sending SIGKILL to ${useProcessGroup ? "process group" : "server process"} ${serverProcess.pid}`);
        sendSignal(serverProcess, "SIGKILL");
        await waitForProcessExit(serverProcess, 2000);
        log("Server process exited after SIGKILL");
      }

      const lingeringPidsAfterExit = listLingeringServerPids();
      if (lingeringPidsAfterExit.length > 0) {
        log(
          `Server process exited but listeners remained on ${listenPorts.join(", ")}: ${lingeringPidsAfterExit.join(", ")}`,
        );
        await cleanupLingeringServerListeners();
      }

      let shutdownMs;
      try {
        shutdownMs = await waitForServerShutdown();
      } catch (error) {
        const cleanedLingeringListeners = await cleanupLingeringServerListeners();
        if (!cleanedLingeringListeners) {
          throw error;
        }
        shutdownMs = await waitForServerShutdown();
      }
      log(`API server shutdown confirmed after cleanup (${shutdownMs}ms)`);
    },
  };
};

module.exports = {
  createSmokeServerController,
};
