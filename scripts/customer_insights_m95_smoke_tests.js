#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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

const RUN_REF = `m95_${Date.now()}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m95-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: STAFF_HEADERS,
  });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.creditEntryIds.length) {
    await prisma.creditLedgerEntry.deleteMany({ where: { id: { in: state.creditEntryIds } } });
  }
  if (state.creditAccountIds.length) {
    await prisma.creditAccount.deleteMany({ where: { id: { in: state.creditAccountIds } } });
  }
  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
  }
  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({ where: { id: { in: state.workshopJobIds } } });
  }
  if (state.customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: state.customerIds } } });
  }
};

const main = async () => {
  const state = {
    customerIds: [],
    workshopJobIds: [],
    saleIds: [],
    creditAccountIds: [],
    creditEntryIds: [],
  };

  try {
    const locationId = await ensureMainLocationId(prisma);

    const [repeatCustomer, workshopCustomer, quietCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          firstName: "Repeat",
          lastName: RUN_REF,
          email: `repeat-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
          firstName: "Workshop",
          lastName: RUN_REF,
          email: `workshop-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
          firstName: "Quiet",
          lastName: RUN_REF,
          email: `quiet-${RUN_REF}@local`,
        },
      }),
    ]);

    state.customerIds.push(repeatCustomer.id, workshopCustomer.id, quietCustomer.id);

    const [saleA, saleB] = await Promise.all([
      prisma.sale.create({
        data: {
          customerId: repeatCustomer.id,
          locationId,
          subtotalPence: 12000,
          taxPence: 0,
          totalPence: 12000,
          completedAt: new Date(),
        },
      }),
      prisma.sale.create({
        data: {
          customerId: repeatCustomer.id,
          locationId,
          subtotalPence: 8000,
          taxPence: 0,
          totalPence: 8000,
          completedAt: new Date(),
        },
      }),
    ]);
    state.saleIds.push(saleA.id, saleB.id);

    const [jobA, jobB] = await Promise.all([
      prisma.workshopJob.create({
        data: {
          customerId: workshopCustomer.id,
          customerName: `${workshopCustomer.firstName} ${workshopCustomer.lastName}`.trim(),
          locationId,
          bikeDescription: "Road bike",
          status: "WAITING_FOR_APPROVAL",
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: workshopCustomer.id,
          customerName: `${workshopCustomer.firstName} ${workshopCustomer.lastName}`.trim(),
          locationId,
          bikeDescription: "Commuter bike",
          status: "IN_PROGRESS",
        },
      }),
    ]);
    state.workshopJobIds.push(jobA.id, jobB.id);

    const creditAccount = await prisma.creditAccount.create({
      data: {
        customerId: repeatCustomer.id,
        email: repeatCustomer.email,
        phone: repeatCustomer.phone,
      },
    });
    state.creditAccountIds.push(creditAccount.id);

    const creditEntry = await prisma.creditLedgerEntry.create({
      data: {
        creditAccountId: creditAccount.id,
        amountPence: 2500,
        sourceType: "MANUAL",
        sourceRef: `m95-${RUN_REF}`,
      },
    });
    state.creditEntryIds.push(creditEntry.id);

    const today = new Date().toISOString().slice(0, 10);
    const { status, json } = await fetchJson(`/api/reports/customers/insights?from=${today}&to=${today}&take=5`);

    assert.equal(status, 200);
    assert.ok(json.summary.customerCount >= 3);
    assert.ok(json.summary.repeatCustomerCount >= 1);
    assert.ok(json.summary.workshopActiveCustomerCount >= 1);
    assert.ok(json.summary.customersWithCreditCount >= 1);
    assert.ok(json.topCustomers.some((row) => row.customerId === repeatCustomer.id && row.saleCount === 2));
    assert.ok(json.repeatCustomers.some((row) => row.customerId === repeatCustomer.id));
    assert.ok(json.workshopActiveCustomers.some((row) => row.customerId === workshopCustomer.id && row.activeWorkshopJobs >= 2));
    assert.equal(json.creditSupported, true);

    console.log("[m95-smoke] customer insights analytics passed");
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
