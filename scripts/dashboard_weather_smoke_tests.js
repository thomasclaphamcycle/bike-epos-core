#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "weather-smoke-staff",
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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const WEATHER_KEYS = [
  "store.city",
  "store.postcode",
  "store.latitude",
  "store.longitude",
];

const assertDailyWeatherSnapshot = (snapshot, label) => {
  assert.ok(snapshot, `${label} weather snapshot should exist`);
  assert.equal(typeof snapshot.summary, "string");
  assert.ok(snapshot.summary.trim().length > 0);
  assert.equal(typeof snapshot.highC, "number");
  assert.ok(Number.isFinite(snapshot.highC));
  assert.equal(typeof snapshot.lowC, "number");
  assert.ok(Number.isFinite(snapshot.lowC));
  assert.equal(typeof snapshot.precipitationMm, "number");
  assert.ok(Number.isFinite(snapshot.precipitationMm));
};

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

const waitForExit = (child, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    }, timeoutMs);

    child.once("exit", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    });
  });

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
      serverProcess = spawn("npx", ["ts-node", "--transpile-only", "src/server.ts"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
          PORT: new URL(BASE_URL).port || "3100",
          COREPOS_WEATHER_STUB: "1",
        },
      });
      startedServer = true;
      await waitForServer();
    }

    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: WEATHER_KEYS,
        },
      },
    });

    const missingRes = await fetchJson("/api/dashboard/weather", { headers: STAFF_HEADERS });
    assert.equal(missingRes.status, 200, JSON.stringify(missingRes.json));
    assert.equal(missingRes.json.weather.status, "missing_location");

    await prisma.appConfig.upsert({
      where: { key: "store.city" },
      create: { key: "store.city", value: "Clapham" },
      update: { value: "Clapham" },
    });
    await prisma.appConfig.upsert({
      where: { key: "store.latitude" },
      create: { key: "store.latitude", value: 51.4526 },
      update: { value: 51.4526 },
    });
    await prisma.appConfig.upsert({
      where: { key: "store.longitude" },
      create: { key: "store.longitude", value: -0.1477 },
      update: { value: -0.1477 },
    });

    const readyRes = await fetchJson("/api/dashboard/weather", { headers: STAFF_HEADERS });
    assert.equal(readyRes.status, 200, JSON.stringify(readyRes.json));
    assert.equal(readyRes.json.weather.status, "ready");
    assert.equal(typeof readyRes.json.weather.locationLabel, "string");
    assert.ok(readyRes.json.weather.locationLabel.trim().length > 0);
    assertDailyWeatherSnapshot(readyRes.json.weather.today, "today");
    assertDailyWeatherSnapshot(readyRes.json.weather.tomorrow, "tomorrow");

    console.log("[dashboard-weather-smoke] dashboard weather endpoint passed");
  } finally {
    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await waitForExit(serverProcess, 1500);
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
        await waitForExit(serverProcess, 500);
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
