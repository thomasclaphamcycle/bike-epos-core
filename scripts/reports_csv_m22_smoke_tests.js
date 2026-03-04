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

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m22-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m22-smoke] DATABASE_URL=${safeDbUrl}`);

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
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const today = new Date().toISOString().slice(0, 10);
    const response = await fetch(
      `${BASE_URL}/api/reports/sales/daily.csv?from=${today}&to=${today}`,
      {
        headers: {
          "X-Staff-Role": "MANAGER",
          "X-Staff-Id": "m22-smoke",
        },
      },
    );

    assert.equal(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assert.equal(contentType.includes("text/csv"), true, `unexpected content-type: ${contentType}`);
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    assert.equal(
      contentDisposition.includes("attachment"),
      true,
      `unexpected content-disposition: ${contentDisposition}`,
    );
    assert.equal(
      contentDisposition.includes("sales_daily.csv"),
      true,
      `unexpected content-disposition filename: ${contentDisposition}`,
    );

    const csv = await response.text();
    const firstLine = csv.split(/\r?\n/)[0];
    assert.equal(firstLine, "date,saleCount,grossPence,refundsPence,netPence");

    console.log("PASS csv endpoint returns text/csv with expected header");
  } finally {
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(300);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
