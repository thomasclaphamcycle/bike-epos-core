#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
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
console.log(`[m58-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m58-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

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

const makeHeaders = (actorId) => ({
  "Content-Type": "application/json",
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": actorId,
});

const apiJson = async ({ path, method = "GET", body, actorId }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: makeHeaders(actorId),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { payload, status: response.status };
};

const fetchCsv = async (path, actorId) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Staff-Role": "ADMIN",
      "X-Staff-Id": actorId,
      Accept: "text/csv",
    },
  });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
};

const run = async () => {
  const token = uniqueRef();
  const actorId = `m58-admin-${token}`;

  const created = {
    actorId,
    productId: null,
    variantId: null,
    basketId: null,
    saleId: null,
    workshopJobId: null,
    workshopSaleId: null,
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

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M58 Product ${token}`,
        brand: "M58",
      },
      actorId,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(created.productId)}/variants`,
      method: "POST",
      body: {
        sku: `M58-SKU-${token}`,
        name: `M58 Variant ${token}`,
        retailPricePence: 2200,
      },
      actorId,
    });
    created.variantId = variant.payload.id;

    const movement = await apiJson({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: created.variantId,
        type: "PURCHASE",
        quantity: 12,
        referenceType: "M58_EXPORT",
        referenceId: token,
      },
      actorId,
    });
    created.inventoryMovementId = movement.payload.id;

    const basket = await apiJson({
      path: "/api/baskets",
      method: "POST",
      body: {},
      actorId,
    });
    created.basketId = basket.payload.id;

    await apiJson({
      path: `/api/baskets/${encodeURIComponent(created.basketId)}/lines`,
      method: "POST",
      body: {
        variantId: created.variantId,
        quantity: 1,
      },
      actorId,
    });

    const checkout = await apiJson({
      path: `/api/baskets/${encodeURIComponent(created.basketId)}/checkout`,
      method: "POST",
      body: {
        paymentMethod: "CASH",
        amountPence: 2200,
        providerRef: `m58-payment-${token}`,
      },
      actorId,
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
      actorId,
    });

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/complete`,
      method: "POST",
      body: {},
      actorId,
    });

    const workshop = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerName: `M58 Customer ${token}`,
        title: `M58 Job ${token}`,
      },
      actorId,
    });
    created.workshopJobId = workshop.payload.id;
    assert.ok(created.workshopJobId, "missing workshop job id");

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines`,
      method: "POST",
      body: {
        type: "LABOUR",
        description: "M58 labour line",
        quantity: 1,
        unitPricePence: 4500,
      },
      actorId,
    });

    const converted = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/convert-to-sale`,
      method: "POST",
      body: {},
      actorId,
    });
    created.workshopSaleId = converted.payload.saleId;
    assert.ok(created.workshopSaleId, "missing converted workshop sale id");

    const salesExport = await fetchCsv("/api/admin/export/sales", actorId);
    assert.equal(salesExport.status, 200);
    assert.ok((salesExport.headers.get("content-type") || "").includes("text/csv"));
    assert.ok((salesExport.headers.get("content-disposition") || "").includes("admin_sales_export.csv"));
    assert.ok(salesExport.text.startsWith("saleId,basketId"), salesExport.text.slice(0, 200));
    assert.ok(salesExport.text.includes(created.saleId), "sales export missing sale id");
    assert.ok(salesExport.text.includes("CASH"), "sales export missing payment method");

    const workshopExport = await fetchCsv("/api/admin/export/workshop", actorId);
    assert.equal(workshopExport.status, 200);
    assert.ok((workshopExport.headers.get("content-type") || "").includes("text/csv"));
    assert.ok(
      (workshopExport.headers.get("content-disposition") || "").includes("admin_workshop_export.csv"),
    );
    assert.ok(workshopExport.text.startsWith("workshopJobId,linkedSaleId"), workshopExport.text.slice(0, 200));
    assert.ok(workshopExport.text.includes(created.workshopJobId), "workshop export missing job id");
    assert.ok(workshopExport.text.includes(created.workshopSaleId), "workshop export missing linked sale id");

    const inventoryExport = await fetchCsv("/api/admin/export/inventory", actorId);
    assert.equal(inventoryExport.status, 200);
    assert.ok((inventoryExport.headers.get("content-type") || "").includes("text/csv"));
    assert.ok(
      (inventoryExport.headers.get("content-disposition") || "").includes(
        "admin_inventory_export.csv",
      ),
    );
    assert.ok(inventoryExport.text.startsWith("inventoryMovementId,movementType"), inventoryExport.text.slice(0, 200));
    assert.ok(
      inventoryExport.text.includes(created.inventoryMovementId),
      "inventory export missing movement id",
    );
    assert.ok(inventoryExport.text.includes(created.productId), "inventory export missing product id");
    assert.ok(inventoryExport.text.includes(",12,"), "inventory export missing quantity change");

    console.log("M58 data export smoke tests passed.");
  } finally {
    const saleIds = [created.saleId, created.workshopSaleId].filter(Boolean);
    const entityIds = [
      created.saleId,
      created.workshopSaleId,
      created.workshopJobId,
      created.inventoryMovementId,
      created.productId,
      created.variantId,
      created.basketId,
    ].filter(Boolean);

    if (saleIds.length > 0) {
      await prisma.receipt.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.cashMovement.deleteMany({ where: { relatedSaleId: { in: saleIds } } });
      await prisma.saleTender.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.payment.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
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

    if (entityIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    }

    await prisma.auditLog.deleteMany({ where: { staffId: created.actorId } });
    await prisma.auditEvent.deleteMany({ where: { actorId: created.actorId } });
    await prisma.user.deleteMany({ where: { id: created.actorId } });

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
