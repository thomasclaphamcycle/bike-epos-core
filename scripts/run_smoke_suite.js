#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");

const baselineSteps = [
  // Core historical baseline
  "test:m11",
  "test:m12",
  "test:m13",
  "test:m28",
  "test:m32",
  "test:m34",
  "test:m35",
  "test:m36",
  "test:m37",
  "test:m38",
  "test:m39",
  "test:m40",
  "test:m41",
  "test:m42",
  "test:m43",
  "test:sale-customer-capture",
  // Current management-reporting surfaces
  "test:m119",
  "test:m120",
  "test:m121",
  "test:m122",
  "test:m123",
  "test:m124",
  "test:m125",
  "test:m126",
  "test:m127",
  "test:m128",
  "test:supplier-product-links",
  "test:product-import",
  "test:stock-transfers",
  "test:bike-hire",
  "test:settings",
  "test:rota-foundation",
  "test:dashboard-weather",
  "test:financial-reports",
];

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "test",
  AUTH_MODE: process.env.AUTH_MODE || "real",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "0",
};

if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
  env.DATABASE_URL = env.TEST_DATABASE_URL;
}
if (!env.TEST_BASE_URL) {
  env.TEST_BASE_URL = "http://localhost:3100";
}

if (
  env.ALLOW_EXISTING_SERVER !== "1" &&
  /^http:\/\/localhost:3000\/?$/i.test(env.TEST_BASE_URL)
) {
  env.TEST_BASE_URL = "http://localhost:3100";
}

if (!env.PORT) {
  try {
    const parsed = new URL(env.TEST_BASE_URL);
    if (parsed.port) {
      env.PORT = parsed.port;
    }
  } catch {
    // Keep default server port behavior if TEST_BASE_URL is not a valid URL.
  }
}

const HEALTH_URL = `${env.TEST_BASE_URL.replace(/\/$/, "")}/health`;
const WAIT_INTERVAL_MS = Number.parseInt(process.env.SMOKE_SERVER_WAIT_INTERVAL_MS || "500", 10);
const HEALTH_CHECK_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_SERVER_HEALTH_TIMEOUT_MS || "1500",
  10,
);
const SHUTDOWN_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_SERVER_SHUTDOWN_TIMEOUT_MS || "15000",
  10,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => {
  console.log(`[smoke-suite] ${message}`);
};

const serverIsHealthy = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      signal: controller.signal,
    });
    return response.ok;
  } catch (error) {
    if (error && typeof error === "object" && error.name === "AbortError") {
      log(`Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms for ${HEALTH_URL}`);
      return true;
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const waitForServerShutdown = async (step) => {
  const startedAt = Date.now();
  let attempt = 0;

  log(`Waiting for API server shutdown after ${step}`);

  while (Date.now() - startedAt < SHUTDOWN_TIMEOUT_MS) {
    attempt += 1;
    if (!(await serverIsHealthy())) {
      log(`API server shutdown confirmed after ${step} (${Date.now() - startedAt}ms, ${attempt} checks)`);
      return;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      log(`API server still responding after ${step}; waiting... (${Date.now() - startedAt}ms elapsed)`);
    }

    await sleep(WAIT_INTERVAL_MS);
  }

  log(`Timed out waiting for API server shutdown after ${step}`);
  throw new Error(
    `Smoke suite timed out after ${SHUTDOWN_TIMEOUT_MS}ms waiting for API server shutdown after ${step}. A smoke test likely did not shut its server down cleanly.`,
  );
};

const main = async () => {
  const existing = await serverIsHealthy();
  if (existing && env.ALLOW_EXISTING_SERVER !== "1") {
    throw new Error(
      "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
    );
  }

  for (const step of baselineSteps) {
    log(`Starting ${step}`);
    const result = spawnSync("npm", ["run", step], {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });

    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }

    log(`Completed ${step}`);

    if (env.ALLOW_EXISTING_SERVER !== "1") {
      await waitForServerShutdown(step);
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
