#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
const { createSmokeServerController } = require("./smoke_server_helper");

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

const serverController = createSmokeServerController({
  label: "m104-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m104_${Date.now()}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": `m104-staff-${RUN_REF}`,
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers: STAFF_HEADERS });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.receiptIds.length) {
    await prisma.receipt.deleteMany({ where: { id: { in: state.receiptIds } } });
  }
  if (state.saleTenderIds.length) {
    await prisma.saleTender.deleteMany({ where: { id: { in: state.saleTenderIds } } });
  }
  if (state.creditEntryIds.length) {
    await prisma.creditLedgerEntry.deleteMany({ where: { id: { in: state.creditEntryIds } } });
  }
  if (state.creditAccountIds.length) {
    await prisma.creditAccount.deleteMany({ where: { id: { in: state.creditAccountIds } } });
  }
  if (state.workshopNoteIds.length) {
    await prisma.workshopJobNote.deleteMany({ where: { id: { in: state.workshopNoteIds } } });
  }
  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
  }
  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({ where: { id: { in: state.workshopJobIds } } });
  }
  if (state.bikeIds.length) {
    await prisma.customerBike.deleteMany({ where: { id: { in: state.bikeIds } } });
  }
  if (state.customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: state.customerIds } } });
  }
  if (state.userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: state.userIds } } });
  }
};

const main = async () => {
  const state = {
    userIds: [],
    customerIds: [],
    bikeIds: [],
    workshopJobIds: [],
    workshopNoteIds: [],
    saleIds: [],
    saleTenderIds: [],
    receiptIds: [],
    creditAccountIds: [],
    creditEntryIds: [],
  };

  try {
    await serverController.startIfNeeded();
    const locationId = await ensureMainLocationId(prisma);

    const customer = await prisma.customer.create({
      data: {
        firstName: "M104",
        lastName: RUN_REF,
        email: `m104-${RUN_REF}@local`,
      },
    });
    state.customerIds.push(customer.id);

    const staff = await prisma.user.create({
      data: {
        username: `m104_${RUN_REF}`,
        email: `m104-staff-${RUN_REF}@local`,
        name: "Timeline Staff",
        passwordHash: "not-used-in-smoke",
        role: "STAFF",
      },
    });
    state.userIds.push(staff.id);

    const bike = await prisma.customerBike.create({
      data: {
        customerId: customer.id,
        label: "Timeline commuter",
        make: "Genesis",
        model: "Day One",
        colour: "Orange",
      },
    });
    state.bikeIds.push(bike.id);

    const job = await prisma.workshopJob.create({
      data: {
        customerId: customer.id,
        locationId,
        bikeId: bike.id,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        locationId,
        bikeDescription: "Timeline bike",
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    state.workshopJobIds.push(job.id);

    const sale = await prisma.sale.create({
      data: {
        customerId: customer.id,
        workshopJobId: job.id,
        locationId,
        subtotalPence: 7500,
        taxPence: 0,
        totalPence: 7500,
        completedAt: new Date(),
        createdByStaffId: staff.id,
      },
    });
    state.saleIds.push(sale.id);

    const tender = await prisma.saleTender.create({
      data: {
        saleId: sale.id,
        method: "CARD",
        amountPence: 7500,
        createdByStaffId: staff.id,
      },
    });
    state.saleTenderIds.push(tender.id);

    const receipt = await prisma.receipt.create({
      data: {
        saleId: sale.id,
        receiptNumber: `R-${RUN_REF}`,
        issuedByStaffId: staff.id,
        shopName: "CorePOS Smoke",
        shopAddress: "1 Timeline Street",
      },
    });
    state.receiptIds.push(receipt.id);

    const note = await prisma.workshopJobNote.create({
      data: {
        workshopJobId: job.id,
        authorStaffId: staff.id,
        visibility: "CUSTOMER",
        note: `Timeline note ${RUN_REF}`,
      },
    });
    state.workshopNoteIds.push(note.id);

    const creditAccount = await prisma.creditAccount.create({
      data: {
        customerId: customer.id,
        email: customer.email,
        phone: customer.phone,
      },
    });
    state.creditAccountIds.push(creditAccount.id);

    const creditEntry = await prisma.creditLedgerEntry.create({
      data: {
        creditAccountId: creditAccount.id,
        amountPence: 1200,
        sourceType: "MANUAL",
        sourceRef: `m104-${RUN_REF}`,
        notes: "Timeline credit",
      },
    });
    state.creditEntryIds.push(creditEntry.id);

    const { status, json } = await fetchJson(`/api/customers/${customer.id}/timeline`);

    assert.equal(status, 200);
    assert.equal(json.customer.id, customer.id);
    assert.equal(json.customer.summary.completedSalesCount, 1);
    assert.equal(json.customer.summary.linkedBikeCount, 1);
    assert.ok(Array.isArray(json.timeline));
    assert.ok(json.timeline.some((item) => item.type === "CUSTOMER_CREATED"));
    assert.ok(json.timeline.some(
      (item) =>
        item.type === "SALE_COMPLETED" &&
        item.entityId === sale.id &&
        item.meta?.receiptNumber === receipt.receiptNumber &&
        item.meta?.paymentSummary === "Card £75.00" &&
        item.meta?.checkoutStaffName === "Timeline Staff",
    ));
    assert.ok(json.timeline.some((item) => item.type === "WORKSHOP_CREATED" && item.entityId === job.id));
    assert.ok(json.timeline.some(
      (item) =>
        item.type === "WORKSHOP_COMPLETED" &&
        item.entityId === job.id &&
        item.meta?.receiptNumber === receipt.receiptNumber,
    ));
    assert.ok(json.timeline.some(
      (item) =>
        item.type === "WORKSHOP_NOTE" &&
        item.summary.includes("Timeline note") &&
        item.meta?.authorName === "Timeline Staff",
    ));
    assert.ok(json.timeline.some(
      (item) =>
        item.type === "BIKE_LINKED" &&
        item.entityId === bike.id &&
        item.summary.includes("Timeline commuter"),
    ));
    assert.ok(json.timeline.some((item) => item.type === "CREDIT_ENTRY" && item.amountPence === 1200));

    console.log("[m104-smoke] customer timeline passed");
  } finally {
    await serverController.stop();
    await cleanup(state);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
