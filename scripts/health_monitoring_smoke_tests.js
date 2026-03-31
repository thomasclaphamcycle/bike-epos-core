#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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

const serverController = createSmokeServerController({
  label: "health-monitoring-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, options);
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
  try {
    await serverController.startIfNeeded();

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
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
