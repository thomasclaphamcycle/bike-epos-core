#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "health-monitoring-manager",
};

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
    assert.match(detailedHealth.json.app.version, /^\d+\.\d+\.\d+$/);
    assert.equal(detailedHealth.json.app.label, `v${detailedHealth.json.app.version}`);
    assert.equal(typeof detailedHealth.json.app.releaseLabel, "string");
    assert.equal(detailedHealth.json.checks.database.status, "ok");
    assert.equal(detailedHealth.json.checks.migrations.status, "ok");
    assert.equal(typeof detailedHealth.json.checks.migrations.appliedCount, "number");
    assert.equal(detailedHealth.json.checks.migrations.pendingCount, 0);
    assert.equal(detailedHealth.json.checks.runtime.status, "ok");
    assert.equal(detailedHealth.json.checks.runtime.environment, "test");
    assert.equal(typeof detailedHealth.json.checks.runtime.nodeVersion, "string");
    assert.equal(typeof detailedHealth.json.checks.runtime.startedAt, "string");
    assert.equal(typeof detailedHealth.json.checks.configuration.status, "string");
    assert.equal(typeof detailedHealth.json.checks.configuration.authMode, "string");
    assert.equal(typeof detailedHealth.json.checks.configuration.frontendServingMode, "string");
    assert.equal(typeof detailedHealth.json.checks.configuration.requestIdHeader, "string");
    assert.equal(typeof detailedHealth.json.checks.configuration.corePosDebugEnabled, "boolean");
    assert.equal(typeof detailedHealth.json.checks.configuration.opsLoggingEnabled, "boolean");

    const versionRes = await fetchJson("/api/system/version");
    assert.equal(versionRes.status, 200, JSON.stringify(versionRes.json));
    assert.equal(versionRes.json.app.version, detailedHealth.json.app.version);
    assert.equal(versionRes.json.app.label, detailedHealth.json.app.label);
    assert.equal(versionRes.json.runtime.environment, "test");
    assert.equal(typeof versionRes.json.runtime.uptimeSeconds, "number");
    assert.equal(typeof versionRes.json.features.shippingPrintAgentConfigured, "boolean");
    assert.equal(typeof versionRes.json.diagnostics.requestIdHeader, "string");

    const metricsRes = await fetchJson("/metrics", { headers: MANAGER_HEADERS });
    assert.equal(metricsRes.status, 200, JSON.stringify(metricsRes.json));
    assert.equal(metricsRes.json.status, "ok");
    assert.equal(metricsRes.json.app.version, detailedHealth.json.app.version);
    assert.equal(metricsRes.json.runtime.environment, "test");
    assert.equal(metricsRes.json.checks.database.status, "ok");
    assert.equal(metricsRes.json.checks.migrations.status, "ok");
    assert.equal(typeof metricsRes.json.features.frontendServingMode, "string");
    assert.equal(typeof metricsRes.json.diagnostics.requestIdHeader, "string");

    console.log("[health-monitoring-smoke] health endpoint detail checks passed");
  } finally {
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
