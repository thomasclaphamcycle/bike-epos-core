#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m54-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m54-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
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

const apiRequest = async ({ path, method = "GET", body, cookie, expectedStatus }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) {
      throw new Error(
        `${method} ${path} expected ${expectedStatus} but got ${response.status}: ${JSON.stringify(payload)}`,
      );
    }
    return { payload, status: response.status };
  }

  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return { payload, status: response.status };
};

const login = async (email, password) => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await parseJson(response);
  assert.equal(response.status, 200, JSON.stringify(payload));
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "missing set-cookie");
  return setCookie.split(";")[0];
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const run = async () => {
  const token = uniqueRef();
  const managerEmail = `m54.manager.${token}@example.com`;
  const managerPassword = `M54Manager!${token}`;

  const created = {
    userId: null,
    customerId: null,
    productId: null,
    variantId: null,
    cancelledJobId: null,
    collectedJobId: null,
    saleId: null,
  };

  let startedServer = false;
  let serverProcess = null;

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
        },
      });
      startedServer = true;
      await waitForServer();
    }

    const manager = await prisma.user.create({
      data: {
        username: `m54-manager-${token}`,
        name: "M54 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const customer = await apiRequest({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M54 Customer ${token}`,
      },
      cookie,
    });
    created.customerId = customer.payload.id;

    const product = await apiRequest({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M54 Product ${token}`,
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiRequest({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: created.productId,
        sku: `M54-SKU-${token}`,
        retailPricePence: 2400,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    await apiRequest({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: created.variantId,
        type: "PURCHASE_RECEIPT",
        quantity: 10,
        referenceType: "M54_TEST",
        referenceId: `m54_${token}`,
      },
      cookie,
    });

    const cancelledJob = await apiRequest({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M54 Cancel Job ${token}`,
      },
      cookie,
    });
    created.cancelledJobId = cancelledJob.payload.id;

    await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.cancelledJobId)}/lines`,
      method: "POST",
      body: {
        type: "PART",
        productId: created.productId,
        quantity: 3,
        unitPricePence: 2400,
      },
      cookie,
    });

    await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.cancelledJobId)}/reservations`,
      method: "POST",
      body: {
        productId: created.productId,
        quantity: 2,
      },
      cookie,
    });

    const beforeCancel = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.cancelledJobId)}`,
      cookie,
    });
    assert.equal(beforeCancel.payload.partsStatus, "SHORT");
    assert.equal(beforeCancel.payload.reservations.length, 1);

    const awaitingParts = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.cancelledJobId)}`,
      method: "PATCH",
      body: { status: "AWAITING_PARTS" },
      cookie,
    });
    assert.equal(awaitingParts.payload.statusV1, "AWAITING_PARTS");

    const cancelled = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.cancelledJobId)}`,
      method: "PATCH",
      body: { status: "CANCELLED" },
      cookie,
    });
    assert.equal(cancelled.payload.statusV1, "CANCELLED");

    const afterCancel = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.cancelledJobId)}`,
      cookie,
    });
    assert.equal(afterCancel.payload.reservations.length, 0);
    assert.equal(afterCancel.payload.partsReconciliation.reservedQty, 0);

    const collectedJob = await apiRequest({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M54 Collected Rule Job ${token}`,
      },
      cookie,
    });
    created.collectedJobId = collectedJob.payload.id;

    await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.collectedJobId)}/lines`,
      method: "POST",
      body: {
        type: "LABOUR",
        description: "Brake service",
        quantity: 1,
        unitPricePence: 3500,
      },
      cookie,
    });

    const converted = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.collectedJobId)}/convert-to-sale`,
      method: "POST",
      body: {},
      cookie,
    });
    created.saleId = converted.payload.saleId;
    assert.ok(created.saleId, "Expected saleId from conversion");

    const collectBlocked = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.collectedJobId)}`,
      method: "PATCH",
      body: { status: "COLLECTED" },
      cookie,
      expectedStatus: 409,
    });
    assert.equal(collectBlocked.payload?.error?.code, "WORKSHOP_JOB_SALE_NOT_COMPLETED");

    const sale = await apiRequest({
      path: `/api/sales/${encodeURIComponent(created.saleId)}`,
      cookie,
    });

    await apiRequest({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: sale.payload.sale.totalPence,
      },
      cookie,
    });

    await apiRequest({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });

    const collectAllowed = await apiRequest({
      path: `/api/workshop/jobs/${encodeURIComponent(created.collectedJobId)}`,
      method: "PATCH",
      body: { status: "COLLECTED" },
      cookie,
    });
    assert.equal(collectAllowed.payload.statusV1, "COLLECTED");

    console.log("M54 workshop workflow smoke tests passed.");
  } finally {
    if (created.saleId) {
      await prisma.saleTender.deleteMany({ where: { saleId: created.saleId } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: created.saleId } });
      await prisma.payment.deleteMany({ where: { saleId: created.saleId } });
      await prisma.receipt.deleteMany({ where: { saleId: created.saleId } });
      await prisma.saleItem.deleteMany({ where: { saleId: created.saleId } });
      await prisma.sale.deleteMany({ where: { id: created.saleId } });
    }

    const jobIds = [created.cancelledJobId, created.collectedJobId].filter(Boolean);
    if (jobIds.length > 0) {
      await prisma.stockReservation.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.workshopJobLine.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.payment.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.workshopCancellation.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.workshopJob.deleteMany({ where: { id: { in: jobIds } } });
    }

    if (created.variantId) {
      await prisma.stockReservation.deleteMany({ where: { variantId: created.variantId } });
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }

    if (created.productId) {
      await prisma.stockReservation.deleteMany({ where: { productId: created.productId } });
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }

    if (created.customerId) {
      await prisma.creditAccount.deleteMany({ where: { customerId: created.customerId } });
      await prisma.customer.deleteMany({ where: { id: created.customerId } });
    }

    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }

    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(400);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
