#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const bridgeDir = path.join(process.cwd(), "tmp", "playwright-bridge");
const bridgeStatePath = path.join(bridgeDir, "state.json");
const bridgeLogPath = path.join(bridgeDir, "daemon.log");
const launchAgentStdoutLogPath = path.join(bridgeDir, "launchagent.stdout.log");

const wsEndpointPattern = /(ws:\/\/localhost:\d+\/[a-z0-9]+)/i;

const ensureBridgeDir = () => {
  fs.mkdirSync(bridgeDir, { recursive: true });
};

const readBridgeState = () => {
  try {
    const raw = fs.readFileSync(bridgeStatePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.wsEndpoint !== "string") {
      throw new Error("Invalid bridge state");
    }
    return parsed;
  } catch {
    return recoverBridgeStateFromLogs();
  }
};

const recoverBridgeStateFromLogs = () => {
  for (const candidatePath of [launchAgentStdoutLogPath, bridgeLogPath]) {
    try {
      const raw = fs.readFileSync(candidatePath, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        const match = line.match(wsEndpointPattern);
        if (match) {
          return {
            pid: null,
            wsEndpoint: match[1],
            startedAt: null,
            browser: "chromium",
            recoveredFrom: candidatePath,
          };
        }
      }
    } catch {
      // Ignore missing log candidates.
    }
  }

  return null;
};

const writeBridgeState = (state) => {
  ensureBridgeDir();
  fs.writeFileSync(bridgeStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const removeBridgeState = () => {
  try {
    fs.unlinkSync(bridgeStatePath);
  } catch {
    // Ignore missing state during cleanup.
  }
};

const applyPlaywrightBridgeEnv = (sourceEnv = process.env) => {
  const env = {
    ...sourceEnv,
  };

  if (env.PW_TEST_CONNECT_WS_ENDPOINT) {
    return env;
  }

  const state = readBridgeState();
  if (state?.wsEndpoint) {
    env.PW_TEST_CONNECT_WS_ENDPOINT = state.wsEndpoint;
  }

  return env;
};

module.exports = {
  applyPlaywrightBridgeEnv,
  bridgeDir,
  bridgeLogPath,
  bridgeStatePath,
  ensureBridgeDir,
  launchAgentStdoutLogPath,
  readBridgeState,
  recoverBridgeStateFromLogs,
  removeBridgeState,
  writeBridgeState,
};
