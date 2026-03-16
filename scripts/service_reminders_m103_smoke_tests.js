#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");

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

const RUN_REF = `m103_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m103-manager-${RUN_REF}`,
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
  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
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
  const state = { customerIds: [], workshopJobIds: [], saleIds: [] };

  try {
    const locationId = await ensureMainLocationId(prisma);

    const [overdueCustomer, dueSoonCustomer, recentCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          name: `M103 Overdue ${RUN_REF}`,
          firstName: "Overdue",
          lastName: RUN_REF,
          email: `m103-overdue-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
          name: `M103 DueSoon ${RUN_REF}`,
          firstName: "DueSoon",
          lastName: RUN_REF,
          email: `m103-due-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
          name: `M103 Recent ${RUN_REF}`,
          firstName: "Recent",
          lastName: RUN_REF,
          email: `m103-recent-${RUN_REF}@local`,
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
      prisma.workshopJob.create({
        data: {
          customerId: overdueCustomer.id,
          customerName: overdueCustomer.name,
          locationId,
          bikeDescription: "Open bike",
          status: "WAITING_FOR_PARTS",
        },
      }),
    ]);
    state.workshopJobIds.push(...jobs.map((job) => job.id));

    const sale = await prisma.sale.create({
      data: {
        customerId: overdueCustomer.id,
        locationId,
        subtotalPence: 5000,
        taxPence: 0,
        totalPence: 5000,
        completedAt: daysAgo(5),
      },
    });
    state.saleIds.push(sale.id);

    const { status, json } = await fetchJson("/api/reports/customers/reminders?dueSoonDays=30&overdueDays=60&lookbackDays=365&take=10");

    assert.equal(status, 200);
    assert.ok(json.summary.customerCount >= 3);
    assert.ok(json.overdueCustomers.some((row) => row.customerId === overdueCustomer.id && row.reminderStatus === "OVERDUE"));
    assert.ok(json.dueSoonCustomers.some((row) => row.customerId === dueSoonCustomer.id && row.reminderStatus === "DUE_SOON"));
    assert.ok(json.recentCompletedCustomers.some((row) => row.customerId === recentCustomer.id && row.reminderStatus === "RECENT_COMPLETION"));
    const overdueRow = json.customers.find((row) => row.customerId === overdueCustomer.id);
    assert.ok(overdueRow);
    assert.equal(overdueRow.activeWorkshopJobs, 1);
    assert.ok(overdueRow.lastSaleAt);

    console.log("[m103-smoke] service reminders passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
