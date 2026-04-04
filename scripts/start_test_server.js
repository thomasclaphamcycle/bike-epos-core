#!/usr/bin/env node
require("dotenv").config({ path: ".env.test", override: true });

const path = require("node:path");
const { register } = require("ts-node");
const { applyTestEnvDefaults } = require("./test_env_defaults");

const env = applyTestEnvDefaults(process.env);
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") {
    process.env[key] = value;
  }
}

register({
  transpileOnly: true,
});

const DEFAULT_PRINT_AGENT_BIND_HOST = "127.0.0.1";
const DEFAULT_PRINT_AGENT_PORT = "3211";
const DEFAULT_PRINT_AGENT_SECRET = "test-print-agent-secret";

if (!process.env.COREPOS_PRINT_AGENT_BIND_HOST) {
  process.env.COREPOS_PRINT_AGENT_BIND_HOST = DEFAULT_PRINT_AGENT_BIND_HOST;
}
if (!process.env.COREPOS_PRINT_AGENT_PORT) {
  process.env.COREPOS_PRINT_AGENT_PORT = DEFAULT_PRINT_AGENT_PORT;
}
if (!process.env.COREPOS_PRINT_AGENT_TRANSPORT) {
  process.env.COREPOS_PRINT_AGENT_TRANSPORT = "DRY_RUN";
}
if (!process.env.COREPOS_PRINT_AGENT_SHARED_SECRET) {
  process.env.COREPOS_PRINT_AGENT_SHARED_SECRET = DEFAULT_PRINT_AGENT_SECRET;
}
if (!process.env.COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET) {
  process.env.COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET = process.env.COREPOS_PRINT_AGENT_SHARED_SECRET;
}
if (!process.env.COREPOS_SHIPPING_PRINT_AGENT_URL) {
  process.env.COREPOS_SHIPPING_PRINT_AGENT_URL = `http://${process.env.COREPOS_PRINT_AGENT_BIND_HOST}:${process.env.COREPOS_PRINT_AGENT_PORT}`;
}

const { startPrintAgentServer } = require(path.join(__dirname, "..", "print-agent", "src", "app.ts"));

let closed = false;
let printAgentHandlePromise = null;
let backendRuntimeInstalled = false;

const stopPrintAgent = async ({ exitCode = 0, forceProcessExit = true } = {}) => {
  if (closed) {
    return;
  }
  closed = true;

  try {
    const handle = await printAgentHandlePromise;
    await handle?.close?.();
  } catch {
    // Best effort shutdown for the embedded test print agent.
  } finally {
    if (forceProcessExit) {
      process.exit(exitCode);
      return;
    }

    process.exitCode = exitCode;
  }
};

process.once("SIGINT", () => {
  void stopPrintAgent({
    exitCode: 0,
    forceProcessExit: !backendRuntimeInstalled,
  });
});
process.once("SIGTERM", () => {
  void stopPrintAgent({
    exitCode: 0,
    forceProcessExit: !backendRuntimeInstalled,
  });
});

printAgentHandlePromise = startPrintAgentServer()
  .then(() => {
    backendRuntimeInstalled = true;
    require(path.join(__dirname, "..", "src", "server.ts"));
  })
  .catch(async (error) => {
    console.error(error);
    await stopPrintAgent({
      exitCode: 1,
      forceProcessExit: true,
    });
  });
