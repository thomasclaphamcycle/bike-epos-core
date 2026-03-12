#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return {
    status: response.status,
    json,
  };
};

const run = async () => {
  let startedServer = false;
  let serverProcess = null;

  try {
    const alreadyHealthy = await serverIsHealthy();
    if (alreadyHealthy && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!alreadyHealthy) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      startedServer = true;
      await waitForServer();
    }

    const basicHealth = await fetchJson("/health");
    assert.equal(basicHealth.status, 200, JSON.stringify(basicHealth.json));
    assert.equal(basicHealth.json.status, "ok");
    assert.equal("checks" in basicHealth.json, false);

    const detailedHealth = await fetchJson("/health?details=1");
    assert.equal(detailedHealth.status, 200, JSON.stringify(detailedHealth.json));
    assert.equal(detailedHealth.json.status, "ok");
    assert.equal(detailedHealth.json.checks.database.status, "ok");
    assert.equal(detailedHealth.json.checks.migrations.status, "ok");
    assert.equal(typeof detailedHealth.json.checks.migrations.appliedCount, "number");
    assert.equal(detailedHealth.json.checks.migrations.pendingCount, 0);

    console.log("[health-monitoring-smoke] health endpoint detail checks passed");
  } finally {
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(400);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
