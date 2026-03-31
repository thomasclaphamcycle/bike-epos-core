#!/usr/bin/env node
require("dotenv/config");
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
const { createSmokeServerController } = require("./smoke_server_helper");
const { emitEvent } = require("../src/utils/domainEvent");
const { runWithRequestContext } = require("../src/lib/requestContext");

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
const server = createSmokeServerController({
  label: "domain-events-smoke",
  baseUrl: BASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /listening|server started|server running/i,
});

const RUN_REF = `domain_events_${Date.now()}`;
const REQUEST_ID = `req_${RUN_REF}`;
const ACTOR_STAFF_ID = `staff_${RUN_REF}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": ACTOR_STAFF_ID,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers: STAFF_HEADERS });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  await prisma.domainEvent.deleteMany({
    where: {
      OR: [
        { requestId: REQUEST_ID },
        { actorStaffId: ACTOR_STAFF_ID },
        { customerId: { in: state.customerIds } },
        { bikeId: { in: state.bikeIds } },
        { workshopJobId: { in: state.workshopJobIds } },
        { saleId: { in: state.saleIds } },
      ],
    },
  });

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
};

const waitForPersistedEvents = async (expectedCount) => {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const count = await prisma.domainEvent.count({
      where: { requestId: REQUEST_ID },
    });

    if (count >= expectedCount) {
      return;
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${expectedCount} persisted domain events.`);
};

const emitSeedEvents = (entities) =>
  runWithRequestContext(
    {
      requestId: REQUEST_ID,
      actorStaffId: ACTOR_STAFF_ID,
      method: "SMOKE",
      route: "/scripts/domain_events_persistence_smoke_tests.js",
    },
    () => {
      emitEvent("workshop.quote.ready", {
        id: `quote_${RUN_REF}`,
        type: "workshop.quote.ready",
        timestamp: new Date().toISOString(),
        workshopJobId: entities.workshopJob.id,
        workshopEstimateId: `estimate_${RUN_REF}`,
        estimateVersion: 2,
      });

      emitEvent("sale.completed", {
        id: entities.sale.id,
        type: "sale.completed",
        timestamp: new Date().toISOString(),
        saleId: entities.sale.id,
        completedAt: entities.sale.completedAt.toISOString(),
        totalPence: entities.sale.totalPence,
      });

      emitEvent("workshop.job.completed", {
        id: entities.workshopJob.id,
        type: "workshop.job.completed",
        timestamp: new Date().toISOString(),
        workshopJobId: entities.workshopJob.id,
        status: "COMPLETED",
        completedAt: entities.workshopJob.completedAt.toISOString(),
        saleId: entities.sale.id,
      });
    },
  );

const main = async () => {
  const state = {
    customerIds: [],
    bikeIds: [],
    workshopJobIds: [],
    saleIds: [],
  };

  try {
    await server.startIfNeeded();

    const locationId = await ensureMainLocationId(prisma);

    const customer = await prisma.customer.create({
      data: {
        firstName: "Domain",
        lastName: "Timeline",
        email: `${RUN_REF}@local`,
      },
    });
    state.customerIds.push(customer.id);

    const bike = await prisma.customerBike.create({
      data: {
        customerId: customer.id,
        label: "Observability commuter",
        make: "Genesis",
        model: "Croix de Fer",
        frameNumber: `FRAME-${RUN_REF}`,
      },
    });
    state.bikeIds.push(bike.id);

    const workshopJob = await prisma.workshopJob.create({
      data: {
        customerId: customer.id,
        bikeId: bike.id,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        bikeDescription: "Observability commuter",
        locationId,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    state.workshopJobIds.push(workshopJob.id);

    const sale = await prisma.sale.create({
      data: {
        customerId: customer.id,
        workshopJobId: workshopJob.id,
        locationId,
        subtotalPence: 8200,
        taxPence: 0,
        totalPence: 8200,
        completedAt: new Date(),
      },
    });
    state.saleIds.push(sale.id);

    emitSeedEvents({ customer, bike, workshopJob, sale });
    await waitForPersistedEvents(3);

    const persistedEvents = await prisma.domainEvent.findMany({
      where: { requestId: REQUEST_ID },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    });

    assert.equal(persistedEvents.length, 3);
    assert.ok(persistedEvents.every((event) => event.actorStaffId === ACTOR_STAFF_ID));
    assert.ok(persistedEvents.every((event) => event.requestId === REQUEST_ID));
    assert.ok(persistedEvents.some((event) => event.customerId === customer.id));
    assert.ok(persistedEvents.some((event) => event.bikeId === bike.id));
    assert.ok(persistedEvents.some((event) => event.workshopJobId === workshopJob.id));
    assert.ok(persistedEvents.some((event) => event.saleId === sale.id));

    const workshopTimeline = await fetchJson(
      `/api/events?entityType=WORKSHOP_JOB&entityId=${encodeURIComponent(workshopJob.id)}`,
    );
    assert.equal(workshopTimeline.status, 200);
    assert.ok(Array.isArray(workshopTimeline.json.events));
    assert.ok(workshopTimeline.json.events.some((event) => event.label === "Quote ready"));
    assert.ok(workshopTimeline.json.events.some((event) => event.label === "Job completed"));

    const customerTimeline = await fetchJson(
      `/api/events?entityType=CUSTOMER&entityId=${encodeURIComponent(customer.id)}`,
    );
    assert.equal(customerTimeline.status, 200);
    assert.ok(customerTimeline.json.events.some((event) => event.label === "Sale completed"));
    assert.ok(customerTimeline.json.events.some((event) => event.label === "Job completed"));

    const bikeTimeline = await fetchJson(
      `/api/events?entityType=BIKE&entityId=${encodeURIComponent(bike.id)}`,
    );
    assert.equal(bikeTimeline.status, 200);
    assert.ok(bikeTimeline.json.events.some((event) => event.label === "Sale completed"));
    assert.ok(bikeTimeline.json.events.some((event) => event.label === "Quote ready"));

    console.log("[domain-events-smoke] persistence timeline checks passed");
  } finally {
    await server.stop();
    await cleanup(state);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
