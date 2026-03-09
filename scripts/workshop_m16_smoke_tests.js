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
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m16-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m16-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const RUN_REF = uniqueRef();
const STAFF_USER_ID = `m16-staff-${RUN_REF}`;

const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": STAFF_USER_ID,
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
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const createCustomerAndJob = async (state) => {
  const ref = uniqueRef();
  const locationId = await ensureMainLocationId(prisma);
  const customer = await prisma.customer.create({
    data: {
      firstName: "M16",
      lastName: "Customer",
      email: `m16.${ref}@example.com`,
      phone: `0733${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
    },
  });
  state.customerIds.add(customer.id);

  const job = await prisma.workshopJob.create({
    data: {
      customerId: customer.id,
      locationId,
      status: "BOOKING_MADE",
      source: "IN_STORE",
      depositStatus: "NOT_REQUIRED",
      depositRequiredPence: 0,
      notes: `m16 job ${ref}`,
    },
  });
  state.workshopJobIds.add(job.id);
  return { customer, job };
};

const cleanup = async (state) => {
  const workshopJobIds = Array.from(state.workshopJobIds);
  const customerIds = Array.from(state.customerIds);
  const productIds = Array.from(state.productIds);
  const variantIds = Array.from(state.variantIds);
  const saleIds = Array.from(state.saleIds);
  const userIds = Array.from(state.userIds);

  await prisma.auditEvent.deleteMany({
    where: {
      actorId: STAFF_USER_ID,
    },
  });

  if (saleIds.length > 0) {
    await prisma.payment.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  }

  if (workshopJobIds.length > 0) {
    await prisma.workshopJobPart.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
    });
    await prisma.workshopJob.deleteMany({ where: { id: { in: workshopJobIds } } });
  }

  if (variantIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.barcode.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: variantIds } } });
  }

  if (productIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }

  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
    customerIds: new Set(),
    productIds: new Set(),
    variantIds: new Set(),
    saleIds: new Set(),
    userIds: new Set(),
  };

  let startedServer = false;
  let serverProcess = null;

  const runTest = async (name, fn, results) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  };

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
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const staffUser = await prisma.user.create({
      data: {
        id: STAFF_USER_ID,
        username: `m16_staff_${RUN_REF}`,
        name: "M16 Staff",
        passwordHash: "test",
        role: "MANAGER",
      },
    });
    state.userIds.add(staffUser.id);

    const results = [];

    await runTest(
      "parts USED/RETURNED writes stock ledger deltas",
      async () => {
        const { job } = await createCustomerAndJob(state);

        const createProductResponse = await fetchJson("/api/products", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            name: `M16 Product ${uniqueRef()}`,
            brand: "M16",
          }),
        });
        assert.equal(createProductResponse.status, 201);
        const productId = createProductResponse.json.id;
        state.productIds.add(productId);

        const createVariantResponse = await fetchJson("/api/variants", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            productId,
            sku: `M16-SKU-${uniqueRef()}`,
            retailPricePence: 1999,
            costPricePence: 1000,
          }),
        });
        assert.equal(createVariantResponse.status, 201);
        const variantId = createVariantResponse.json.id;
        state.variantIds.add(variantId);

        const stockAdjust = await fetchJson("/api/stock/adjustments", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            variantId,
            quantityDelta: 10,
            note: "m16 opening",
          }),
        });
        assert.equal(stockAdjust.status, 201);
        const locationId = stockAdjust.json.stock?.locationId ?? stockAdjust.json.entry?.locationId;
        assert.ok(locationId);

        const addPart = await fetchJson(`/api/workshop-jobs/${job.id}/parts`, {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            variantId,
            quantity: 2,
            status: "USED",
            locationId,
          }),
        });
        assert.equal(addPart.status, 201);
        assert.equal(addPart.json.totals.partsUsedTotalPence, 3998);

        const partId = addPart.json.part.id;

        const stockAfterUse = await fetchJson(
          `/api/stock/variants/${variantId}?locationId=${encodeURIComponent(locationId)}`,
          { headers: STAFF_HEADERS },
        );
        assert.equal(stockAfterUse.status, 200, JSON.stringify(stockAfterUse.json));
        assert.equal(stockAfterUse.json.onHand, 8);

        const patchPart = await fetchJson(`/api/workshop-jobs/${job.id}/parts/${partId}`, {
          method: "PATCH",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            status: "RETURNED",
            locationId,
          }),
        });
        assert.equal(patchPart.status, 200);
        assert.equal(patchPart.json.part.status, "RETURNED");

        const stockAfterReturn = await fetchJson(
          `/api/stock/variants/${variantId}?locationId=${encodeURIComponent(locationId)}`,
          { headers: STAFF_HEADERS },
        );
        assert.equal(stockAfterReturn.status, 200, JSON.stringify(stockAfterReturn.json));
        assert.equal(stockAfterReturn.json.onHand, 10);
      },
      results,
    );

    await runTest(
      "checkout includes USED workshop parts in sale total",
      async () => {
        const { job } = await createCustomerAndJob(state);

        const createProductResponse = await fetchJson("/api/products", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            name: `M16 Checkout Product ${uniqueRef()}`,
          }),
        });
        assert.equal(createProductResponse.status, 201);
        const productId = createProductResponse.json.id;
        state.productIds.add(productId);

        const createVariantResponse = await fetchJson("/api/variants", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            productId,
            sku: `M16-CHK-SKU-${uniqueRef()}`,
            retailPricePence: 1499,
          }),
        });
        assert.equal(createVariantResponse.status, 201);
        const variantId = createVariantResponse.json.id;
        state.variantIds.add(variantId);

        const addPart = await fetchJson(`/api/workshop-jobs/${job.id}/parts`, {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            variantId,
            quantity: 1,
            status: "USED",
          }),
        });
        assert.equal(addPart.status, 201);

        const checkout = await fetchJson(`/api/workshop/jobs/${job.id}/checkout`, {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            saleTotalPence: 5000,
          }),
        });
        assert.equal(checkout.status, 201);
        assert.equal(checkout.json.partsTotalPence, 1499);
        assert.equal(checkout.json.serviceTotalPence, 5000);
        assert.equal(checkout.json.saleTotalPence, 6499);
        assert.equal(checkout.json.outstandingPence, 6499);
        state.saleIds.add(checkout.json.sale.id);
      },
      results,
    );

    await runTest(
      "deleting a USED part creates compensating stock movement",
      async () => {
        const { job } = await createCustomerAndJob(state);

        const createProductResponse = await fetchJson("/api/products", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            name: `M16 Delete Product ${uniqueRef()}`,
          }),
        });
        assert.equal(createProductResponse.status, 201);
        const productId = createProductResponse.json.id;
        state.productIds.add(productId);

        const createVariantResponse = await fetchJson("/api/variants", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            productId,
            sku: `M16-DEL-SKU-${uniqueRef()}`,
            retailPricePence: 999,
          }),
        });
        assert.equal(createVariantResponse.status, 201);
        const variantId = createVariantResponse.json.id;
        state.variantIds.add(variantId);

        const stockAdjust = await fetchJson("/api/stock/adjustments", {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            variantId,
            quantityDelta: 4,
          }),
        });
        assert.equal(stockAdjust.status, 201);
        const locationId = stockAdjust.json.stock?.locationId ?? stockAdjust.json.entry?.locationId;
        assert.ok(locationId);

        const addPart = await fetchJson(`/api/workshop-jobs/${job.id}/parts`, {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            variantId,
            quantity: 1,
            status: "USED",
            locationId,
          }),
        });
        assert.equal(addPart.status, 201);
        const partId = addPart.json.part.id;

        const stockAfterUse = await fetchJson(
          `/api/stock/variants/${variantId}?locationId=${encodeURIComponent(locationId)}`,
          { headers: STAFF_HEADERS },
        );
        assert.equal(stockAfterUse.status, 200);
        assert.equal(stockAfterUse.json.onHand, 3);

        const removePart = await fetchJson(`/api/workshop-jobs/${job.id}/parts/${partId}`, {
          method: "DELETE",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            locationId,
          }),
        });
        assert.equal(removePart.status, 200);

        const stockAfterRemove = await fetchJson(
          `/api/stock/variants/${variantId}?locationId=${encodeURIComponent(locationId)}`,
          { headers: STAFF_HEADERS },
        );
        assert.equal(stockAfterRemove.status, 200);
        assert.equal(stockAfterRemove.json.onHand, 4);
      },
      results,
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
      return;
    }
  } finally {
    await cleanup(state).catch((error) => {
      console.error("Cleanup failed:", error instanceof Error ? error.message : String(error));
    });

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
    }

    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
