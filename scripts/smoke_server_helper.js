#!/usr/bin/env node
require("dotenv/config");

const { applyTestEnvDefaults } = require("./test_env_defaults");
const {
  installSignalHandlers,
  listListeningPidsForPort,
  signalCodeToExitCode,
  spawnManagedProcess,
  terminateChildProcess,
} = require("./process_lifecycle");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const activeStopHandlers = new Set();
let releaseCleanupSignalHandlers = null;
let signalCleanupInFlight = false;

const trimLog = (value, maxChars) =>
  value.length > maxChars ? value.slice(value.length - maxChars) : value;

const registerActiveStopHandler = (stopHandler) => {
  activeStopHandlers.add(stopHandler);

  if (!releaseCleanupSignalHandlers) {
    releaseCleanupSignalHandlers = installSignalHandlers(async (signal) => {
      if (signalCleanupInFlight) {
        return;
      }
      signalCleanupInFlight = true;

      try {
        await Promise.allSettled(
          Array.from(activeStopHandlers).map((handler) => handler()),
        );
      } finally {
        if (releaseCleanupSignalHandlers) {
          releaseCleanupSignalHandlers();
          releaseCleanupSignalHandlers = null;
        }
        signalCleanupInFlight = false;
        process.exit(signalCodeToExitCode(signal));
      }
    });
  }

  return () => {
    activeStopHandlers.delete(stopHandler);
    if (activeStopHandlers.size === 0 && releaseCleanupSignalHandlers) {
      releaseCleanupSignalHandlers();
      releaseCleanupSignalHandlers = null;
      signalCleanupInFlight = false;
    }
  };
};

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

    while (Date.now() - startedAt < shutdownTimeoutMs) {
      if (!(await serverIsHealthy())) {
        return Date.now() - startedAt;
      }
      await sleep(shutdownPollMs);
    }

    throw new Error(
      `Server still responded on /health after ${shutdownTimeoutMs}ms${
        lastProbeDetail ? `\nlast probe: ${lastProbeDetail}` : ""
      }`,
    );
  };

  const listLingeringServerPids = () =>
    Array.from(
      new Set(
        listenPorts.flatMap((port) => listListeningPidsForPort(port)),
      ),
    );

  let serverProcess = null;
  let startedServer = false;
  let stopPromise = null;
  let unregisterStopHandler = null;

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

  const controller = {
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
          `Refusing to run against an already-running server at ${alreadyHealthy}. Stop it first or set ALLOW_EXISTING_SERVER=1.${
            lastProbeDetail ? `\nlast probe: ${lastProbeDetail}` : ""
          }`,
        );
      }

      if (alreadyHealthy) {
        activeBaseUrl = alreadyHealthy;
        log(`Reusing existing API server at ${alreadyHealthy}`);
        return false;
      }

      log(`Starting API server with ${startup.command} ${startup.args.join(" ")}`);
      const startupEnv = applyTestEnvDefaults({
        ...process.env,
        NODE_ENV: "test",
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        ...envOverrides,
      });
      serverProcess = spawnManagedProcess(startup.command, startup.args, {
        stdio: captureStartupLog ? ["ignore", "pipe", "pipe"] : "ignore",
        env: startupEnv,
      });
      if (captureStartupLog) {
        const appendStartupLog = (chunk) => {
          startupLog = trimLog(`${startupLog}${String(chunk)}`, startupLogCharLimit);
        };
        serverProcess.stdout?.on("data", appendStartupLog);
        serverProcess.stderr?.on("data", appendStartupLog);
      }
      unregisterStopHandler = registerActiveStopHandler(() => controller.stop());
      startedServer = true;
      log(
        `Spawned API server pid=${serverProcess.pid} ports=${listenPorts.join(", ")} base=${defaultBaseUrl}`,
      );
      await waitForServerReady(serverProcess);
      return true;
    },
    async stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        if (!startedServer || !serverProcess) {
          if (unregisterStopHandler) {
            unregisterStopHandler();
            unregisterStopHandler = null;
          }
          return;
        }

        log("Starting API server cleanup");

        try {
          await terminateChildProcess(serverProcess, {
            label: "API server",
            log,
          });
          log("Server process exited");
        } finally {
          if (unregisterStopHandler) {
            unregisterStopHandler();
            unregisterStopHandler = null;
          }
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
      })();

      try {
        await stopPromise;
      } finally {
        serverProcess = null;
        startedServer = false;
      }
    },
  };

  return controller;
};

module.exports = {
  createSmokeServerController,
};
