#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
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
  label: "m121-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m121_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m121-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: state.purchaseOrderIds } } });
  }
  if (state.variantIds.length) {
    await prisma.barcode.deleteMany({ where: { variantId: { in: state.variantIds } } });
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
  try {
    await serverController.startIfNeeded();

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
              unitCostPence: 900,
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
              unitCostPence: 1100,
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
              unitCostPence: 500,
            },
          ],
        },
      },
    });

    state.purchaseOrderIds.push(poA1.id, poA2.id, poB.id);

    await prisma.supplierProductLink.create({
      data: {
        supplierId: supplierA.id,
        variantId: productA.variants[0].id,
        supplierCostPence: 1100,
        preferredSupplier: true,
      },
    });

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

    const costHistory = await fetchJson("/api/reports/suppliers/cost-history?take=5");
    assert.equal(costHistory.status, 200);
    assert.ok(costHistory.json.summary.trackedSupplierVariantCount >= 2);
    assert.ok(costHistory.json.summary.changedSupplierVariantCount >= 1);

    const supplierACostRow = costHistory.json.items.find((row) => row.supplierId === supplierA.id);
    assert.ok(supplierACostRow, "expected supplier A cost history row");
    assert.equal(supplierACostRow.currentUnitCostPence, 1100);
    assert.equal(supplierACostRow.previousUnitCostPence, 900);
    assert.equal(supplierACostRow.changePence, 200);
    assert.equal(supplierACostRow.supplierLinkCostPence, 1100);
    assert.equal(supplierACostRow.preferredSupplierLink, true);

    console.log("[m121-smoke] supplier performance report passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
