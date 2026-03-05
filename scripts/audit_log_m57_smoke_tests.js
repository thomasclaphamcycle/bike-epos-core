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
console.log(`[m57-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m57-smoke] DATABASE_URL=${safeDbUrl}`);

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

const apiJson = async ({ path, method = "GET", body, cookie, expectStatus }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (expectStatus !== undefined) {
    assert.equal(response.status, expectStatus, JSON.stringify(payload));
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
  const managerEmail = `m57.manager.${token}@example.com`;
  const managerPassword = `M57Manager!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    basketId: null,
    saleId: null,
    workshopJobId: null,
    stocktakeId: null,
    inventoryMovementId: null,
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
        username: `m57-manager-${token}`,
        name: "M57 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M57 Product ${token}`,
        brand: "M57",
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(created.productId)}/variants`,
      method: "POST",
      body: {
        sku: `M57-SKU-${token}`,
        name: `M57 Variant ${token}`,
        retailPricePence: 3000,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    const movement = await apiJson({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: created.variantId,
        type: "PURCHASE",
        quantity: 5,
        referenceType: "M57_TEST",
        referenceId: token,
      },
      cookie,
    });
    created.inventoryMovementId = movement.payload.id;

    const basket = await apiJson({
      path: "/api/baskets",
      method: "POST",
      body: {},
      cookie,
    });
    created.basketId = basket.payload.id;

    await apiJson({
      path: `/api/baskets/${encodeURIComponent(created.basketId)}/lines`,
      method: "POST",
      body: {
        variantId: created.variantId,
        quantity: 1,
      },
      cookie,
    });

    const checkout = await apiJson({
      path: `/api/baskets/${encodeURIComponent(created.basketId)}/checkout`,
      method: "POST",
      body: {},
      cookie,
    });
    created.saleId = checkout.payload.sale?.id;
    assert.ok(created.saleId, "missing sale id");

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: checkout.payload.sale.totalPence,
      },
      cookie,
    });

    const completion = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(completion.payload.completedAt, "sale completion missing completedAt");

    const workshopJob = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerName: `M57 Customer ${token}`,
        title: `M57 Job ${token}`,
      },
      cookie,
    });
    created.workshopJobId = workshopJob.payload.id;
    assert.ok(created.workshopJobId, "missing workshop job id");

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      method: "PATCH",
      body: {
        status: "IN_PROGRESS",
      },
      cookie,
    });

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      method: "PATCH",
      body: {
        status: "CANCELLED",
      },
      cookie,
    });

    const locations = await apiJson({
      path: "/api/locations",
      cookie,
    });
    const locationId = locations.payload.locations?.[0]?.id;
    assert.ok(locationId, "missing stock location");

    const stocktake = await apiJson({
      path: "/api/stocktakes",
      method: "POST",
      body: {
        locationId,
        notes: `M57 stocktake ${token}`,
      },
      cookie,
    });
    created.stocktakeId = stocktake.payload.id;
    assert.ok(created.stocktakeId, "missing stocktake id");

    await apiJson({
      path: `/api/stocktakes/${encodeURIComponent(created.stocktakeId)}/lines`,
      method: "POST",
      body: {
        variantId: created.variantId,
        countedQty: 2,
      },
      cookie,
    });

    await apiJson({
      path: `/api/stocktakes/${encodeURIComponent(created.stocktakeId)}/post`,
      method: "POST",
      body: {},
      cookie,
    });

    const today = new Date().toISOString().slice(0, 10);

    const saleAudit = await apiJson({
      path: `/api/audit?entity=SALE&entityId=${encodeURIComponent(created.saleId)}&limit=50`,
      cookie,
    });
    assert.ok(Array.isArray(saleAudit.payload.logs), JSON.stringify(saleAudit.payload));
    assert.ok(
      saleAudit.payload.logs.some((entry) => entry.action === "SALE_COMPLETED"),
      JSON.stringify(saleAudit.payload),
    );

    const workshopAudit = await apiJson({
      path: `/api/audit?entity=WORKSHOP_JOB&entityId=${encodeURIComponent(created.workshopJobId)}&limit=100`,
      cookie,
    });
    assert.ok(
      workshopAudit.payload.logs.some((entry) => entry.action === "WORKSHOP_STATUS_CHANGED"),
      JSON.stringify(workshopAudit.payload),
    );
    assert.ok(
      workshopAudit.payload.logs.some((entry) => entry.action === "WORKSHOP_CANCELLED"),
      JSON.stringify(workshopAudit.payload),
    );

    const movementAudit = await apiJson({
      path: `/api/audit?entity=INVENTORY_MOVEMENT&entityId=${encodeURIComponent(created.inventoryMovementId)}&action=INVENTORY_MOVEMENT&limit=20`,
      cookie,
    });
    assert.ok(
      movementAudit.payload.logs.some((entry) => entry.id && entry.entityId === created.inventoryMovementId),
      JSON.stringify(movementAudit.payload),
    );

    const stocktakeAudit = await apiJson({
      path: `/api/audit?entity=STOCKTAKE&entityId=${encodeURIComponent(created.stocktakeId)}&action=STOCK_ADJUSTMENT&limit=20`,
      cookie,
    });
    assert.ok(
      stocktakeAudit.payload.logs.some((entry) => entry.action === "STOCK_ADJUSTMENT"),
      JSON.stringify(stocktakeAudit.payload),
    );

    const byStaffAndDate = await apiJson({
      path: `/api/audit?staffId=${encodeURIComponent(created.userId)}&dateFrom=${today}&dateTo=${today}&limit=200`,
      cookie,
    });
    assert.ok(Array.isArray(byStaffAndDate.payload.events), JSON.stringify(byStaffAndDate.payload));
    assert.ok(
      byStaffAndDate.payload.events.some((entry) => entry.actorId === created.userId),
      JSON.stringify(byStaffAndDate.payload),
    );

    console.log("M57 audit log smoke tests passed.");
  } finally {
    if (created.stocktakeId) {
      await prisma.stocktakeLine.deleteMany({ where: { stocktakeId: created.stocktakeId } });
      await prisma.stocktake.deleteMany({ where: { id: created.stocktakeId } });
    }

    if (created.workshopJobId) {
      await prisma.stockReservation.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJobLine.deleteMany({ where: { jobId: created.workshopJobId } });
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.payment.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopCancellation.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJob.deleteMany({ where: { id: created.workshopJobId } });
    }

    if (created.saleId) {
      await prisma.receipt.deleteMany({ where: { saleId: created.saleId } });
      await prisma.cashMovement.deleteMany({ where: { relatedSaleId: created.saleId } });
      await prisma.saleTender.deleteMany({ where: { saleId: created.saleId } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: created.saleId } });
      await prisma.payment.deleteMany({ where: { saleId: created.saleId } });
      await prisma.saleItem.deleteMany({ where: { saleId: created.saleId } });
      await prisma.sale.deleteMany({ where: { id: created.saleId } });
    }

    if (created.basketId) {
      await prisma.basketItem.deleteMany({ where: { basketId: created.basketId } });
      await prisma.basket.deleteMany({ where: { id: created.basketId } });
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

    if (created.userId) {
      await prisma.auditLog.deleteMany({ where: { staffId: created.userId } });
      await prisma.auditEvent.deleteMany({ where: { actorId: created.userId } });
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
  process.exitCode = 1;
});
