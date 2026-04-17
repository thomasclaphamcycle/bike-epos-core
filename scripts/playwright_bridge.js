#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const {
  bridgeDir,
  bridgeLogPath,
  ensureBridgeDir,
  readBridgeState,
  removeBridgeState,
  writeBridgeState,
} = require("./playwright_bridge_support");

const command = process.argv[2] || "status";

const log = (message) => {
  console.log(`[playwright-bridge] ${message}`);
};

const isProcessAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      return true;
    }
    return false;
  }
};

const removeStaleStateIfNeeded = () => {
  const state = readBridgeState();
  if (state?.pid && !isProcessAlive(state.pid)) {
    removeBridgeState();
    return null;
  }
  return state;
};

const printStatus = () => {
  const state = removeStaleStateIfNeeded();
  if (!state) {
    log("No active browser bridge.");
    return 1;
  }

  if (state.pid) {
    log(`Active browser bridge pid=${state.pid}`);
  } else {
    log("Active browser bridge recovered from logs");
  }
  log(`wsEndpoint=${state.wsEndpoint}`);
  if (state.browser) {
    log(`browser=${state.browser}`);
  }
  if (state.recoveredFrom) {
    log(`recoveredFrom=${state.recoveredFrom}`);
  }
  return 0;
};

const waitForStateFile = async (timeoutMs = 15000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = removeStaleStateIfNeeded();
    if (state?.wsEndpoint) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};

const startBridge = async () => {
  const existing = removeStaleStateIfNeeded();
  if (existing?.wsEndpoint) {
    log(`Reusing existing browser bridge at ${existing.wsEndpoint}`);
    return 0;
  }

  ensureBridgeDir();
  const out = fs.openSync(bridgeLogPath, "a");
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "playwright_bridge.js"), "daemon"],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
      },
    },
  );
  child.unref();

  const state = await waitForStateFile();
  if (!state?.wsEndpoint) {
    log(`Bridge failed to start. Check ${bridgeLogPath}`);
    return 1;
  }

  log(`Browser bridge ready at ${state.wsEndpoint}`);
  return 0;
};

const stopBridge = () => {
  const state = removeStaleStateIfNeeded();
  if (!state?.pid) {
    log("No active browser bridge to stop.");
    return 0;
  }

  try {
    process.kill(state.pid, "SIGTERM");
    log(`Sent SIGTERM to browser bridge pid=${state.pid}`);
    return 0;
  } catch (error) {
    log(`Failed to stop browser bridge pid=${state.pid}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

const runDaemon = async () => {
  ensureBridgeDir();

  const launchOptions = {
    headless: process.env.PLAYWRIGHT_BRIDGE_HEADLESS !== "0",
  };
  const browserChannel = process.env.PLAYWRIGHT_BRIDGE_CHANNEL;
  if (browserChannel) {
    launchOptions.channel = browserChannel;
  }

  let server;
  const keepAliveTimer = setInterval(() => {}, 1000);

  const shutdown = async (signal) => {
    clearInterval(keepAliveTimer);
    if (server) {
      try {
        await server.close();
      } catch {
        // Best-effort shutdown.
      }
    }
    removeBridgeState();
    process.exit(signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", async (error) => {
    console.error(error);
    await shutdown("uncaughtException");
  });

  server = await chromium.launchServer(launchOptions);
  writeBridgeState({
    pid: process.pid,
    wsEndpoint: server.wsEndpoint(),
    startedAt: new Date().toISOString(),
    browser: browserChannel || "chromium",
    headless: launchOptions.headless,
    logPath: bridgeLogPath,
  });

  console.log(`[playwright-bridge] Browser bridge listening at ${server.wsEndpoint()}`);
  await new Promise(() => {});
};

const main = async () => {
  switch (command) {
    case "start":
      process.exit(await startBridge());
      break;
    case "stop":
      process.exit(stopBridge());
      break;
    case "status":
      process.exit(printStatus());
      break;
    case "daemon":
      await runDaemon();
      break;
    default:
      console.error("Usage: node scripts/playwright_bridge.js <start|stop|status>");
      process.exit(1);
  }
};

void main();
