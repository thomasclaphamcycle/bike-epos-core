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
console.log(`[m53-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m53-smoke] DATABASE_URL=${safeDbUrl}`);

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

const apiJson = async ({ path, method = "GET", body, cookie }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
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
  const managerEmail = `m53.manager.${token}@example.com`;
  const managerPassword = `M53Manager!${token}`;

  const created = {
    userId: null,
    customerId: null,
    productId: null,
    variantId: null,
    workshopJobIdA: null,
    workshopJobIdB: null,
    saleIdA: null,
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
        username: `m53-manager-${token}`,
        name: "M53 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const customer = await apiJson({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M53 Customer ${token}`,
      },
      cookie,
    });
    created.customerId = customer.payload.id;

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M53 Product ${token}`,
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: created.productId,
        sku: `M53-SKU-${token}`,
        retailPricePence: 1200,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    await apiJson({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: created.variantId,
        type: "PURCHASE_RECEIPT",
        quantity: 12,
        referenceType: "M53_TEST",
        referenceId: `m53_${token}`,
      },
      cookie,
    });

    const jobA = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M53 Job A ${token}`,
      },
      cookie,
    });
    created.workshopJobIdA = jobA.payload.id;

    const jobB = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M53 Job B ${token}`,
      },
      cookie,
    });
    created.workshopJobIdB = jobB.payload.id;

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdA)}/lines`,
      method: "POST",
      body: {
        type: "PART",
        productId: created.productId,
        quantity: 3,
        unitPricePence: 1200,
      },
      cookie,
    });

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdB)}/lines`,
      method: "POST",
      body: {
        type: "PART",
        productId: created.productId,
        quantity: 2,
        unitPricePence: 1200,
      },
      cookie,
    });

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdA)}/reservations`,
      method: "POST",
      body: {
        productId: created.productId,
        quantity: 3,
      },
      cookie,
    });
    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdB)}/reservations`,
      method: "POST",
      body: {
        productId: created.productId,
        quantity: 2,
      },
      cookie,
    });

    const converted = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdA)}/convert-to-sale`,
      method: "POST",
      body: {},
      cookie,
    });
    created.saleIdA = converted.payload.saleId;
    assert.ok(created.saleIdA, "expected saleId from conversion");

    const salePayload = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleIdA)}`,
      cookie,
    });
    assert.equal(salePayload.payload.sale.totalPence, 3600);

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleIdA)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: salePayload.payload.sale.totalPence,
      },
      cookie,
    });

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleIdA)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });

    const jobAAfter = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdA)}`,
      cookie,
    });
    assert.equal(jobAAfter.payload.partsStatus, "OK");
    assert.equal(jobAAfter.payload.reservations.length, 0);
    assert.equal(jobAAfter.payload.partsReconciliation.requiredRemainingQty, 0);

    const jobBAfter = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobIdB)}`,
      cookie,
    });
    assert.equal(jobBAfter.payload.partsStatus, "OK");
    assert.equal(jobBAfter.payload.reservations.length, 1);
    assert.equal(jobBAfter.payload.partsReconciliation.requiredRemainingQty, 2);
    assert.equal(jobBAfter.payload.partsReconciliation.reservedQty, 2);

    const productSearch = await apiJson({
      path: `/api/products/search?sku=${encodeURIComponent(`M53-SKU-${token}`)}`,
      cookie,
    });
    const row = (productSearch.payload.rows || []).find((entry) => entry.id === created.variantId);
    assert.ok(row, "expected variant row in product search");
    assert.equal(row.onHandQty, 9);
    assert.equal(row.reservedQty, 2);
    assert.equal(row.availableQty, 7);

    console.log("M53 reservation consumption smoke tests passed.");
  } finally {
    if (created.saleIdA) {
      await prisma.saleTender.deleteMany({ where: { saleId: created.saleIdA } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: created.saleIdA } });
      await prisma.payment.deleteMany({ where: { saleId: created.saleIdA } });
      await prisma.receipt.deleteMany({ where: { saleId: created.saleIdA } });
      await prisma.saleItem.deleteMany({ where: { saleId: created.saleIdA } });
      await prisma.sale.deleteMany({ where: { id: created.saleIdA } });
    }
    if (created.workshopJobIdA || created.workshopJobIdB) {
      const jobIds = [created.workshopJobIdA, created.workshopJobIdB].filter(Boolean);
      await prisma.stockReservation.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.workshopJobLine.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: { in: jobIds } } });
      await prisma.payment.deleteMany({ where: { workshopJobId: { in: jobIds } } });
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
