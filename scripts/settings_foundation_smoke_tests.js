#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "settings-smoke-manager",
};
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "settings-smoke-staff",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error("Refusing to run against non-test database URL.");
}

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const run = async () => {
  let startedServer = false;
  let serverProcess = null;

  try {
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
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

    const defaultRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(defaultRes.status, 200, JSON.stringify(defaultRes.json));
    assert.equal(defaultRes.json.settings.store.name, "Bike EPOS");
    assert.equal(defaultRes.json.settings.pos.defaultTaxRatePercent, 20);
    assert.equal(defaultRes.json.settings.workshop.defaultDepositPence, 1000);
    assert.equal(defaultRes.json.settings.operations.lowStockThreshold, 3);

    const patchRes = await fetchJson("/api/settings", {
      method: "PATCH",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store: {
          name: "CorePOS Cycles",
          email: "support@corepos.local",
        },
        pos: {
          defaultTaxRatePercent: 17.5,
          barcodeSearchAutoFocus: false,
        },
        workshop: {
          defaultJobDurationMinutes: 75,
        },
        operations: {
          lowStockThreshold: 6,
        },
      }),
    });
    assert.equal(patchRes.status, 200, JSON.stringify(patchRes.json));
    assert.equal(patchRes.json.settings.store.name, "CorePOS Cycles");
    assert.equal(patchRes.json.settings.store.email, "support@corepos.local");
    assert.equal(patchRes.json.settings.store.phone, "");
    assert.equal(patchRes.json.settings.pos.defaultTaxRatePercent, 17.5);
    assert.equal(patchRes.json.settings.pos.barcodeSearchAutoFocus, false);
    assert.equal(patchRes.json.settings.workshop.defaultJobDurationMinutes, 75);
    assert.equal(patchRes.json.settings.workshop.defaultDepositPence, 1000);
    assert.equal(patchRes.json.settings.operations.lowStockThreshold, 6);

    const persistedRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(persistedRes.status, 200, JSON.stringify(persistedRes.json));
    assert.equal(persistedRes.json.settings.store.name, "CorePOS Cycles");

    const staffRes = await fetchJson("/api/settings", { headers: STAFF_HEADERS });
    assert.equal(staffRes.status, 403, JSON.stringify(staffRes.json));
    assert.equal(staffRes.json.error.code, "INSUFFICIENT_ROLE");

    console.log("[settings-smoke] persisted settings API passed");
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
