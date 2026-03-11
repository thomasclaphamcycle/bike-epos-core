#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");

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
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const RUN_REF = `m124_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m124-manager-${RUN_REF}`,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers: MANAGER_HEADERS });
  const json = await response.json();
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

const cleanup = async (state) => {
  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({ where: { id: { in: state.workshopJobIds } } });
  }
  if (state.customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: state.customerIds } } });
  }
};

const daysAgo = (days) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
};

const main = async () => {
  const state = { customerIds: [], workshopJobIds: [] };
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

    const locationId = await ensureMainLocationId(prisma);

    const [overdueCustomer, dueSoonCustomer, recentCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          name: `M124 Overdue ${RUN_REF}`,
          firstName: "Overdue",
          lastName: RUN_REF,
          phone: `07123${String(Date.now()).slice(-6)}`,
        },
      }),
      prisma.customer.create({
        data: {
          name: `M124 DueSoon ${RUN_REF}`,
          firstName: "DueSoon",
          lastName: RUN_REF,
          email: `m124-due-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
          name: `M124 Recent ${RUN_REF}`,
          firstName: "Recent",
          lastName: RUN_REF,
          email: `m124-recent-${RUN_REF}@local`,
        },
      }),
    ]);
    state.customerIds.push(overdueCustomer.id, dueSoonCustomer.id, recentCustomer.id);

    const jobs = await Promise.all([
      prisma.workshopJob.create({
        data: {
          customerId: overdueCustomer.id,
          customerName: overdueCustomer.name,
          locationId,
          bikeDescription: "Overdue bike",
          status: "COMPLETED",
          completedAt: daysAgo(120),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: dueSoonCustomer.id,
          customerName: dueSoonCustomer.name,
          locationId,
          bikeDescription: "Due soon bike",
          status: "COMPLETED",
          completedAt: daysAgo(45),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: recentCustomer.id,
          customerName: recentCustomer.name,
          locationId,
          bikeDescription: "Recent bike",
          status: "COMPLETED",
          completedAt: daysAgo(10),
        },
      }),
    ]);
    state.workshopJobIds.push(...jobs.map((job) => job.id));

    const { status, json } = await fetchJson("/api/reports/customers/reminders?dueSoonDays=30&overdueDays=60&lookbackDays=365&take=10");

    assert.equal(status, 200);
    assert.ok(json.summary.customerCount >= 3);
    assert.ok(json.summary.recentActivityCount >= 1);

    const overdueRow = json.items.find((row) => row.customerId === overdueCustomer.id);
    const dueSoonRow = json.items.find((row) => row.customerId === dueSoonCustomer.id);
    const recentRow = json.items.find((row) => row.customerId === recentCustomer.id);

    assert.ok(overdueRow);
    assert.equal(overdueRow.reminderStatus, "OVERDUE");
    assert.equal(overdueRow.contact, overdueCustomer.phone);
    assert.equal(overdueRow.daysSinceLastWorkshopJob >= 120, true);

    assert.ok(dueSoonRow);
    assert.equal(dueSoonRow.reminderStatus, "DUE_SOON");
    assert.equal(dueSoonRow.contact, dueSoonCustomer.email);
    assert.equal(dueSoonRow.lastWorkshopJobDate.slice(0, 10), jobs[1].completedAt.toISOString().slice(0, 10));

    assert.ok(recentRow);
    assert.equal(recentRow.reminderStatus, "RECENT_ACTIVITY");
    assert.equal(recentRow.latestWorkshopJobId, jobs[2].id);

    console.log("[m124-smoke] customer reminders report passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
