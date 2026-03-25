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

const RUN_REF = `m111_${Date.now()}`;
const MANAGER_HEADERS = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m111-manager-${RUN_REF}`,
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...MANAGER_HEADERS,
    },
  });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.workshopNoteIds.length) {
    await prisma.workshopJobNote.deleteMany({ where: { id: { in: state.workshopNoteIds } } });
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
    workshopNoteIds: [],
  };

  try {
    const locationId = await ensureMainLocationId(prisma);

    const customer = await prisma.customer.create({
      data: {
        name: `M111 Customer ${RUN_REF}`,
        firstName: "M111",
        lastName: RUN_REF,
        email: `m111-${RUN_REF}@local`,
      },
    });
    state.customerIds.push(customer.id);

    const job = await prisma.workshopJob.create({
      data: {
        customerId: customer.id,
        customerName: customer.name,
        locationId,
        bikeDescription: `Warranty bike ${RUN_REF}`,
        status: "IN_PROGRESS",
        notes: `Warranty intake ${RUN_REF}`,
      },
    });
    state.workshopJobIds.push(job.id);

    const openResult = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
      method: "POST",
      body: JSON.stringify({
        visibility: "INTERNAL",
        note: `[WARRANTY:OPEN] Initial warranty review ${RUN_REF}`,
      }),
    });
    assert.equal(openResult.status, 201);
    state.workshopNoteIds.push(openResult.json.note.id);

    const reportResult = await fetchJson("/api/reports/workshop/warranty?take=20");
    assert.equal(reportResult.status, 200);
    assert.ok(Array.isArray(reportResult.json.items));
    const openRow = reportResult.json.items.find((item) => item.workshopJobId === job.id);
    assert.ok(openRow);
    assert.equal(openRow.warrantyStatus, "OPEN");
    assert.match(openRow.latestWarrantyNote, /Initial warranty review/);

    const resolvedResult = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
      method: "POST",
      body: JSON.stringify({
        visibility: "INTERNAL",
        note: `[WARRANTY:RESOLVED] Resolved ${RUN_REF}`,
      }),
    });
    assert.equal(resolvedResult.status, 201);
    state.workshopNoteIds.push(resolvedResult.json.note.id);

    const filteredResult = await fetchJson("/api/reports/workshop/warranty?status=RESOLVED&take=20");
    assert.equal(filteredResult.status, 200);
    const resolvedRow = filteredResult.json.items.find((item) => item.workshopJobId === job.id);
    assert.ok(resolvedRow);
    assert.equal(resolvedRow.warrantyStatus, "RESOLVED");

    console.log("[m111-smoke] warranty tracking passed");
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
