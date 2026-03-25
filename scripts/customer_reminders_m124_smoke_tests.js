#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
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
const serverController = createSmokeServerController({
  label: "m124-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m124_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m124-manager-${RUN_REF}`,
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers: MANAGER_HEADERS });
  const json = await response.json();
  return { status: response.status, json };
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
  try {
    await serverController.startIfNeeded();

    const locationId = await ensureMainLocationId(prisma);

    const [overdueCustomer, dueSoonCustomer, recentCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          firstName: "Overdue",
          lastName: RUN_REF,
          phone: `07123${String(Date.now()).slice(-6)}`,
        },
      }),
      prisma.customer.create({
        data: {
          firstName: "DueSoon",
          lastName: RUN_REF,
          email: `m124-due-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
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
          customerName: `${overdueCustomer.firstName} ${overdueCustomer.lastName}`.trim(),
          locationId,
          bikeDescription: "Overdue bike",
          status: "COMPLETED",
          completedAt: daysAgo(120),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: dueSoonCustomer.id,
          customerName: `${dueSoonCustomer.firstName} ${dueSoonCustomer.lastName}`.trim(),
          locationId,
          bikeDescription: "Due soon bike",
          status: "COMPLETED",
          completedAt: daysAgo(45),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: recentCustomer.id,
          customerName: `${recentCustomer.firstName} ${recentCustomer.lastName}`.trim(),
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
    await serverController.stop();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
