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
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const RUN_REF = `m121_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m121-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: state.purchaseOrderIds } } });
  }
  if (state.variantIds.length) {
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
  if (state.supplierIds.length) {
    await prisma.supplier.deleteMany({ where: { id: { in: state.supplierIds } } });
  }
};

const main = async () => {
  const state = { supplierIds: [], productIds: [], variantIds: [], purchaseOrderIds: [] };
  let startedServer = false;
  let serverProcess = null;

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
      startedServer = true;
      await waitForServer();
    }

    const [supplierA, supplierB] = await Promise.all([
      prisma.supplier.create({ data: { name: `M121 Alpha ${RUN_REF}` } }),
      prisma.supplier.create({ data: { name: `M121 Beacon ${RUN_REF}` } }),
    ]);
    state.supplierIds.push(supplierA.id, supplierB.id);

    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M121 Product A ${RUN_REF}`,
          variants: { create: { sku: `M121-A-${RUN_REF}`, retailPricePence: 1000 } },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M121 Product B ${RUN_REF}`,
          variants: { create: { sku: `M121-B-${RUN_REF}`, retailPricePence: 2000 } },
        },
        include: { variants: true },
      }),
    ]);
    state.productIds.push(productA.id, productB.id);
    state.variantIds.push(productA.variants[0].id, productB.variants[0].id);

    const poA1 = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO26${RUN_REF.slice(-6)}01`,
        supplierId: supplierA.id,
        status: "PARTIALLY_RECEIVED",
        expectedAt: new Date(Date.now() - 86_400_000),
        items: {
          create: [
            {
              variantId: productA.variants[0].id,
              quantityOrdered: 10,
              quantityReceived: 6,
            },
          ],
        },
      },
    });

    const poA2 = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO26${RUN_REF.slice(-6)}02`,
        supplierId: supplierA.id,
        status: "SENT",
        expectedAt: new Date(Date.now() + 86_400_000),
        items: {
          create: [
            {
              variantId: productA.variants[0].id,
              quantityOrdered: 5,
              quantityReceived: 0,
            },
          ],
        },
      },
    });

    const poB = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO26${RUN_REF.slice(-6)}03`,
        supplierId: supplierB.id,
        status: "RECEIVED",
        items: {
          create: [
            {
              variantId: productB.variants[0].id,
              quantityOrdered: 4,
              quantityReceived: 4,
            },
          ],
        },
      },
    });

    state.purchaseOrderIds.push(poA1.id, poA2.id, poB.id);

    const { status, json } = await fetchJson("/api/reports/suppliers/performance");

    assert.equal(status, 200);
    assert.ok(json.summary.supplierCount >= 2);
    assert.ok(json.summary.purchaseOrderCount >= 3);

    const supplierARow = json.suppliers.find((row) => row.supplierId === supplierA.id);
    const supplierBRow = json.suppliers.find((row) => row.supplierId === supplierB.id);

    assert.ok(supplierARow, "expected supplier A row");
    assert.equal(supplierARow.purchaseOrderCount, 2);
    assert.equal(supplierARow.openPurchaseOrderCount, 2);
    assert.equal(supplierARow.partiallyReceivedCount, 1);
    assert.equal(supplierARow.receivedPurchaseOrderCount, 0);
    assert.equal(supplierARow.overdueOpenPurchaseOrderCount, 1);
    assert.equal(supplierARow.totalOrderedQuantity, 15);
    assert.equal(supplierARow.totalReceivedQuantity, 6);

    assert.ok(supplierBRow, "expected supplier B row");
    assert.equal(supplierBRow.purchaseOrderCount, 1);
    assert.equal(supplierBRow.openPurchaseOrderCount, 0);
    assert.equal(supplierBRow.receivedPurchaseOrderCount, 1);
    assert.equal(supplierBRow.totalOrderedQuantity, 4);
    assert.equal(supplierBRow.totalReceivedQuantity, 4);

    console.log("[m121-smoke] supplier performance report passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
