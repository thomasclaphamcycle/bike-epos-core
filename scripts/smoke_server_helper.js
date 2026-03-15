#!/usr/bin/env node
require("dotenv/config");

const { spawn } = require("node:child_process");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createSmokeServerController = ({
  label,
  baseUrl,
  databaseUrl,
  startup = {
    command: "npm",
    args: ["run", "dev"],
  },
  startupIntervalMs = 500,
  startupChecks = 60,
  shutdownTimeoutMs = 5000,
  shutdownPollMs = 250,
  envOverrides = {},
} = {}) => {
  if (!label) {
    throw new Error("label is required");
  }
  if (!baseUrl) {
    throw new Error("baseUrl is required");
  }

  const healthUrl = `${baseUrl.replace(/\/$/, "")}/health`;
  const log = (message) => {
    console.log(`[${label}] ${message}`);
  };

  const serverIsHealthy = async () => {
    try {
      const response = await fetch(healthUrl);
      return response.ok;
    } catch {
      return false;
    }
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
        throw new Error("Server exited before becoming healthy on /health");
      }
      if (await serverIsHealthy()) {
        return;
      }
      await sleep(startupIntervalMs);
    }

    throw new Error("Server did not become healthy on /health");
  };

  const waitForServerShutdown = async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < shutdownTimeoutMs) {
      if (!(await serverIsHealthy())) {
        return Date.now() - startedAt;
      }
      await sleep(shutdownPollMs);
    }

    throw new Error(`Server still responded on /health after ${shutdownTimeoutMs}ms`);
  };

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

  return {
    log,
    async startIfNeeded() {
      const alreadyHealthy = await serverIsHealthy();
      if (alreadyHealthy && process.env.ALLOW_EXISTING_SERVER !== "1") {
        throw new Error(
          "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
        );
      }

      if (alreadyHealthy) {
        return false;
      }

      log(`Starting API server with ${startup.command} ${startup.args.join(" ")}`);
      serverProcess = spawn(resolvedCommand, startup.args, {
        stdio: "ignore",
        detached: useProcessGroup,
        env: {
          ...process.env,
          NODE_ENV: "test",
          ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
          ...envOverrides,
        },
      });
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

      const shutdownMs = await waitForServerShutdown();
      log(`API server shutdown confirmed after cleanup (${shutdownMs}ms)`);
    },
  };
};

module.exports = {
  createSmokeServerController,
};
