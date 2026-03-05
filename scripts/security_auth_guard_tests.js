#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });
require("dotenv").config();

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "demo",
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

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

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
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
  let customerId = null;
  let workshopJobId = null;

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
          JWT_SECRET: process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || "test-jwt-secret",
          COOKIE_SECRET: process.env.COOKIE_SECRET || "test-cookie-secret",
        },
      });
      startedServer = true;
      await waitForServer();
    }

    const ref = `${Date.now()}`;
    const customer = await prisma.customer.create({
      data: {
        firstName: "Security",
        lastName: "Guard",
        email: `security.guard.${ref}@example.com`,
        phone: `0799${ref.slice(-7).padStart(7, "0")}`,
      },
    });
    customerId = customer.id;

    const job = await prisma.workshopJob.create({
      data: {
        customerId: customer.id,
        status: "BOOKING_MADE",
        source: "IN_STORE",
        depositStatus: "NOT_REQUIRED",
        depositRequiredPence: 0,
        notes: "security auth guard verification",
      },
    });
    workshopJobId = job.id;

    const today = new Date().toISOString().slice(0, 10);
    const endpoints = [
      {
        // Current route equivalent of requested /api/workshop/jobs/:id/parts
        name: "workshop parts",
        path: `/api/workshop-jobs/${encodeURIComponent(workshopJobId)}/parts`,
      },
      {
        // Current route equivalent of requested /api/reports/sales
        name: "sales report",
        path: `/api/reports/sales/daily?from=${today}&to=${today}`,
      },
      {
        // Current route equivalent of requested /api/workshop/reports/financial
        name: "workshop financial report",
        path: `/api/reports/workshop/payments?from=${today}&to=${today}`,
      },
      {
        // Current route equivalent of requested /api/credit/balance
        name: "credit balance",
        path: "/api/credits/balance?email=guard@example.com&phone=07000000000",
      },
      {
        name: "workshop dashboard",
        path: "/api/workshop/dashboard?limit=5",
      },
    ];

    for (const endpoint of endpoints) {
      const unauthorized = await fetchJson(endpoint.path);

      if (unauthorized.status === 200) {
        throw new Error(
          `Expected ${endpoint.name} to reject unauthenticated access, but got 200.`,
        );
      }

      assert.ok(
        unauthorized.status === 401 || unauthorized.status === 403,
        `${endpoint.name} expected 401/403 without auth, got ${unauthorized.status} ${JSON.stringify(unauthorized.json)}`,
      );
    }

    for (const endpoint of endpoints) {
      const authorized = await fetchJson(endpoint.path, {
        headers: MANAGER_HEADERS,
      });

      assert.equal(
        authorized.status,
        200,
        `${endpoint.name} expected 200 with manager headers, got ${authorized.status} ${JSON.stringify(authorized.json)}`,
      );
    }

    console.log("Security auth guard tests passed.");
  } finally {
    if (workshopJobId) {
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId } });
      await prisma.stockReservation.deleteMany({ where: { workshopJobId } });
      await prisma.workshopJob.deleteMany({ where: { id: workshopJobId } });
    }
    if (customerId) {
      await prisma.customer.deleteMany({ where: { id: customerId } });
    }
    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
